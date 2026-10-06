import { describe, expect, it } from "bun:test";
import {
  type ChangedRecords,
  computePlan,
  type DeliveryWorkspace,
  KeysetPager,
  type PlanDependencies,
  type RecordFiles,
  recordHash,
  type ScriptChecker,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

const RULE = "global/sys_script/rule--0123456789abcdef0123456789abcdef";
const NEW = "global/sys_script_include/util--fedcba9876543210fedcba9876543210";

function record(
  className: string,
  sysId: string,
  fields: Record<string, string>,
  script?: string,
): RecordFiles {
  const all = script === undefined ? fields : { ...fields, script };
  return {
    document: {
      _meta: {
        sys_class_name: className,
        sys_id: sysId,
        scope: "global",
        hash: recordHash(className, all),
      },
      ...fields,
    },
    files: script === undefined ? [] : [{ field: "script", content: `${script}\n` }],
  };
}

interface State {
  mirror: Record<string, RecordFiles>;
  working: Record<string, RecordFiles>;
  changed: string[];
  integrated: boolean;
  texts: Record<string, string>;
  waivers: unknown;
}

function fakeWorkspace(state: State): DeliveryWorkspace {
  return {
    metadataRoot: "instances/dev/metadata",
    mirrorCommit: async () => (Object.keys(state.mirror).length === 0 ? null : "c0ffee"),
    includes: async () => state.integrated,
    branch: async () => "feature/p1",
    changedFiles: async () => state.changed,
    read: async (base, at) => (at === null ? state.working : state.mirror)[base] ?? null,
    text: async (path) => state.texts[path] ?? null,
    waivers: async () => state.waivers,
  };
}

// validate's view: the same records; the checker reports eval() as SN-SEC-001.
function governance(state: State) {
  const records: ChangedRecords = {
    resolve: async () => "c0ffee",
    changedSince: async () => [...new Set(state.changed.map((p) => p.replace(/\..*$/, "")))],
    current: async (base) => {
      const stored = state.working[base];
      const script = stored?.files[0]?.content ?? "";
      return stored === undefined
        ? null
        : {
            className: "sys_script_include",
            scope: "global",
            fields: { description: "d", script },
            files: { script: `${base}.script.js` },
          };
    },
    at: async (_commit, base) =>
      state.mirror[base] === undefined
        ? null
        : {
            className: "sys_script_include",
            scope: "global",
            fields: { description: "d" },
            files: {},
          },
  };
  const checker: ScriptChecker = {
    check: (source) => ({
      parsed: true,
      hits: source.includes("eval(") ? [{ ruleId: "SN-SEC-001", line: 1, message: "eval" }] : [],
    }),
  };
  return { records, checker };
}

function setup(overrides: Partial<State> = {}, held: Record<string, unknown>[] = []) {
  const state: State = {
    mirror: {
      [RULE]: record(
        "sys_script",
        "0123456789abcdef0123456789abcdef",
        { name: "Rule", order: "100" },
        "a();",
      ),
    },
    working: {
      [RULE]: record(
        "sys_script",
        "0123456789abcdef0123456789abcdef",
        { name: "Rule", order: "200" },
        "a();",
      ),
    },
    changed: [`${RULE}.yaml`],
    integrated: true,
    texts: {},
    waivers: null,
    ...overrides,
  };
  const fake = fakeInstance({
    sys_update_set: [
      { sys_id: "s1", name: "Someone's work", state: "in progress" },
      { sys_id: "s2", name: "snagentic: feature/p1 [global]", state: "in progress" },
    ],
    sys_update_xml: held.map((row) => ({ sys_id: "x", sys_updated_by: "pat", ...row })),
  });
  const deps: PlanDependencies = {
    workspace: fakeWorkspace(state),
    governance: governance(state),
    updateSets: {
      pager: new KeysetPager(fake.reader),
      statistics: fake.reader,
      now: () => new Date(),
    },
    now: () => new Date("2026-10-06T12:00:00Z"),
    signal: new AbortController().signal,
  };
  return { deps, state };
}

const QUERY = { instance: "dev", allowCollisions: false };

describe("computePlan", () => {
  it("plans the changed fields of an edited record, ready to push", async () => {
    const { plan, writes } = await computePlan(setup().deps, QUERY);
    expect(plan).toMatchObject({
      instance: "dev",
      mirrorCommit: "c0ffee",
      label: "feature/p1",
      updateSets: ["snagentic: feature/p1 [global]"],
      changes: [
        { operation: "update", table: "sys_script", path: `${RULE}.yaml`, fields: ["order"] },
      ],
      problems: [],
      gate: { passed: true },
      collisions: [],
      ready: true,
    });
    expect(plan.planId).toMatch(/^[0-9a-f]{16}$/);
    expect(plan.next).toEqual([
      { tool: "push", args: { instance: "dev", plan: plan.planId, confirm: true } },
    ]);
    expect(writes[0]?.values).toEqual({ order: "200" });
    expect(JSON.stringify(plan)).not.toContain('"200"');
  });

  it("plans a new record as a create", async () => {
    const created = record(
      "sys_script_include",
      "fedcba9876543210fedcba9876543210",
      { name: "Util" },
      "var Util;",
    );
    const { plan } = await computePlan(
      setup({
        working: { [NEW]: created },
        mirror: setup().state.mirror,
        changed: [`${NEW}.yaml`, `${NEW}.script.js`],
      }).deps,
      QUERY,
    );
    expect(plan.changes).toEqual([
      expect.objectContaining({ operation: "create", fields: ["name", "script"] }),
    ]);
  });

  it("is not ready when validate blocks, unless a waiver in force covers the finding", async () => {
    const risky = record(
      "sys_script",
      "0123456789abcdef0123456789abcdef",
      { name: "Rule", order: "100" },
      "eval(x);",
    );
    const blocked = await computePlan(setup({ working: { [RULE]: risky } }).deps, QUERY);
    expect(blocked.plan).toMatchObject({
      ready: false,
      gate: { passed: false, blocking: [{ ruleId: "SN-SEC-001" }] },
    });
    expect(blocked.plan.next).toEqual([{ tool: "validate", args: { base: "c0ffee" } }]);
    const waivers = {
      waivers: [
        {
          rule: "SN-SEC-001",
          path: "instances/dev/metadata/global/**",
          reason: "r",
          approver: "lead",
          expires: "2026-12-31",
        },
      ],
    };
    const waived = await computePlan(setup({ working: { [RULE]: risky }, waivers }).deps, QUERY);
    expect(waived.plan).toMatchObject({
      ready: true,
      gate: { passed: true, waived: [{ approver: "lead" }] },
    });
    expect(waived.plan.planId).not.toBe(blocked.plan.planId);
  });

  it("reports deletes, child rows and conflict markers as problems", async () => {
    const { plan } = await computePlan(
      setup({
        working: {},
        changed: [`${RULE}.yaml`, `${RULE}.children.sys_x.yaml`],
        texts: { [`${RULE}.children.sys_x.yaml`]: "<<<<<<< HEAD\n" },
      }).deps,
      QUERY,
    );
    expect(plan.problems.map((p) => p.reason)).toEqual([
      expect.stringContaining("child rows are read-only"),
      expect.stringContaining("conflict markers"),
      expect.stringContaining("deleting records is not supported"),
    ]);
    expect(plan.ready).toBe(false);
  });

  it("blocks on records held in someone else's open update set, not in ours", async () => {
    const name = "sys_script_0123456789abcdef0123456789abcdef";
    const theirs = await computePlan(setup({}, [{ name, update_set: "s1" }]).deps, QUERY);
    expect(theirs.plan).toMatchObject({
      ready: false,
      collisions: [
        { record: name, heldBy: [{ updateSetName: "Someone's work", updatedBy: "pat" }] },
      ],
    });
    expect(
      (
        await computePlan(setup({}, [{ name, update_set: "s1" }]).deps, {
          ...QUERY,
          allowCollisions: true,
        })
      ).plan.ready,
    ).toBe(true);
    expect(
      (await computePlan(setup({}, [{ name, update_set: "s2" }]).deps, QUERY)).plan.collisions,
    ).toEqual([]);
  });

  it("needs a pull, integrated into the branch", async () => {
    await expect(computePlan(setup({ mirror: {} }).deps, QUERY)).rejects.toMatchObject({
      code: "nothing-pulled-yet",
    });
    await expect(computePlan(setup({ integrated: false }).deps, QUERY)).rejects.toMatchObject({
      code: "mirror-not-integrated",
    });
  });

  it("is not ready when nothing changed", async () => {
    const { plan } = await computePlan(setup({ changed: [] }).deps, QUERY);
    expect(plan).toMatchObject({ changes: [], ready: false });
  });
});
