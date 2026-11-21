import { describe, expect, it } from "bun:test";
import {
  computeUnitPlan,
  type PendingDelivery,
  pendingDecision,
  pushUnits,
  RecordChangedOnInstanceError,
  type UnitPushDependencies,
} from "@snagentic/core";
import { orphanedPending, pendingJournal } from "../../src/delivery/application/plan-pending";
import { PendingDeliveryTargetError } from "../../src/delivery/domain/errors";
import { flowSetup, flowUnit } from "./flow-fixture";
import { QUERY, SI_ID, SI_UNIT, scriptInclude, unitSetup } from "./unit-fixture";

// The messages a developer acts on when a delivery stops (spec 016, R4). They name only
// commands that exist, and count what they say they count.

const NO_EXIT =
  "no command can finish or abandon this delivery yet: keep the push journal and ask for help (docs/guides/recover-interrupted-delivery.md)";

describe("a record that moved between plan and load", () => {
  it("names the drift remedy the plan names: pull, then adopt --refresh", () => {
    const error = new RecordChangedOnInstanceError(
      { updateName: SI_UNIT, table: "sys_script_include", sysId: SI_ID },
      "dev",
      0,
    );
    expect(error.code).toBe("record-changed-on-instance");
    expect(error.message).toBe(
      `${SI_UNIT} changed on the instance after the plan read it; no record was loaded`,
    );
    expect(error.hint).toBe(
      `run snagentic plan-push again to see what changed; for a record you adopted, run snagentic pull dev, then snagentic adopt --instance dev --refresh sys_script_include:${SI_ID}, then plan and push again`,
    );
  });

  it("counts the projects already loaded, which is what the journal holds", () => {
    const error = new RecordChangedOnInstanceError(
      { updateName: SI_UNIT, table: "sys_script_include", sysId: SI_ID },
      "dev",
      2,
    );
    expect(error.message).toBe(
      `${SI_UNIT} changed on the instance after the plan read it; nothing was loaded for its project, but 2 other project(s) of this push were already loaded`,
    );
  });

  it("reports no loaded project when the first project's record moved", async () => {
    const { deps } = unitSetup({ source: "Changed in source." });
    const { plan } = await computeUnitPlan(deps, QUERY);
    let reads = 0;
    const query: typeof deps.reader.query = async (request, signal) => {
      const rows = await deps.reader.query(request, signal);
      const unit = String(request.table) === "sys_script_include";
      if (unit) reads += 1;
      return unit && reads > 2 ? rows.map((row) => ({ ...row, sys_mod_count: "5" })) : rows;
    };
    const moving = { ...deps, reader: { ...deps.reader, query } };
    const error = await pushUnits(moving, { ...QUERY, planId: plan.planId, confirm: true }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      message: `${SI_UNIT} changed on the instance after the plan read it; no record was loaded`,
      hint: expect.stringContaining(
        `snagentic adopt --instance dev --refresh sys_script_include:${SI_ID}`,
      ),
    });
  });
});

describe("a flow that fails verification", () => {
  const push = async (deps: UnitPushDependencies) => {
    const { plan } = await computeUnitPlan(deps, QUERY);
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    return result.units[0]?.mismatches;
  };

  it("says the capture lacks its published snapshot", async () => {
    const context = flowSetup();
    const installer: UnitPushDependencies["installer"] = {
      ...context.deps.installer,
      publish: async (_scope, targets) =>
        targets.flows.map((sysId) => ({ sysId, published: true, message: "ok" })),
    };
    expect(await push({ ...context.deps, installer })).toEqual([
      "the capture in the update set is not a published definition: it lacks its published snapshot",
    ]);
  });

  it("names the captured rows and fields that differ from the reviewed build", async () => {
    const context = flowSetup();
    const installer = { ...context.deps.installer, load: async () => {} };
    expect(await push({ ...context.deps, installer })).toEqual([
      "the captured definition does not match the reviewed build: sys_hub_action_instance [a1].inputs",
    ]);
  });

  it("says no capture was found", async () => {
    const context = flowSetup();
    const original = context.deps.installer.publish;
    const installer: UnitPushDependencies["installer"] = {
      ...context.deps.installer,
      publish: async (...args) => {
        const results = await original(...args);
        context.tables["sys_update_xml"] = [];
        return results;
      },
    };
    expect(await push({ ...context.deps, installer })).toEqual([
      "no capture of this definition was found in the update set",
    ]);
  });

  it("names the live fields that differ from the reviewed build", async () => {
    const context = flowSetup();
    const original = context.deps.installer.publish;
    const installer: UnitPushDependencies["installer"] = {
      ...context.deps.installer,
      publish: async (...args) => {
        const results = await original(...args);
        context.tables["sys_hub_flow"] = (context.tables["sys_hub_flow"] ?? []).map((row) => ({
          ...row,
          name: "Different live definition",
        }));
        return results;
      },
    };
    expect(await push({ ...context.deps, installer })).toEqual([
      "the definition on the instance does not match the reviewed build: sys_hub_flow.name",
    ]);
  });
});

describe("an unfinished delivery that blocks a plan", () => {
  const receipt: PendingDelivery = {
    project: "source/x_app",
    updateName: SI_UNIT,
    digest: "digest",
    updateSet: "set1",
    before: "1|old",
    operation: "load",
    removes: null,
  };
  const journal = (pending: readonly PendingDelivery[] | undefined, steps = 0) => ({
    planId: "p",
    mirrorCommit: "",
    startedAt: "then",
    instance: "dev",
    url: "https://dev.example.com",
    label: "feature/p1",
    ...(pending === undefined ? {} : { pending }),
    preferences: [],
    steps: Array.from({ length: steps }, () => ({
      operation: "load",
      table: "source",
      sysId: "source/x_app",
      state: "written" as const,
    })),
  });
  const deps = (held: ReturnType<typeof journal>, state: string | null) => ({
    journal: { read: async () => held, write: async () => {}, clear: async () => {} },
    url: "https://dev.example.com",
    reader: {
      query: async () => (state === null ? [] : [{ state, name: "snagentic: feature/p1" }]),
    } as unknown as UnitPushDependencies["reader"],
    signal: new AbortController().signal,
    workspace: { branch: async () => "feature/p1" },
  });
  const reasons = async (held: ReturnType<typeof journal>, state: string | null, label?: string) =>
    (await pendingJournal(deps(held, state), "dev", label)).problems.map((p) => p.reason);

  it("names recovery or restoring the source when the source changed", () => {
    const unit = scriptInclude("Changed again.");
    expect(pendingDecision(unit, "other", null, receipt, undefined)).toEqual({
      kind: "unsafe",
      reason:
        "unfinished delivery: source changed before its previous delivery was completed; if the instance already holds this build, review snagentic plan-push --recover-pending; otherwise restore the source that was pushed and plan again (docs/guides/recover-interrupted-delivery.md)",
    });
  });

  it("says plainly what is left when the record moved on the instance", () => {
    const unit = flowUnit("wanted");
    const copy = { head: {}, children: [], version: "9|later", foreignRows: 0 };
    expect(
      pendingDecision(unit, "digest", copy, { ...receipt, observed: "2|now" }, undefined),
    ).toEqual({
      kind: "unsafe",
      reason: `unfinished delivery: the instance changed after the last known delivery version; snagentic plan-push --recover-pending finishes it only if the instance holds exactly this build with its original capture; if that refuses, ${NO_EXIT}`,
    });
  });

  it("names reopening a closed update set, and no command when it is gone", async () => {
    expect(await reasons(journal([receipt]), "complete")).toEqual([
      `unfinished delivery's update set set1 is missing or closed: if it was closed, set its state back to In progress on the instance and plan again; otherwise ${NO_EXIT}`,
    ]);
    expect((await reasons(journal([receipt]), null))[0]).toContain(NO_EXIT);
  });

  it("says no command clears a legacy journal", async () => {
    expect(await reasons(journal(undefined, 1), "in progress")).toEqual([
      `legacy interrupted push has no per-unit delivery evidence: check on the instance what its update sets hold; ${NO_EXIT}`,
    ]);
  });

  it("names the original instance and label to finish with", async () => {
    expect(await reasons(journal([receipt]), "in progress", "other")).toEqual([
      'unfinished delivery belongs to a different instance URL or batch label: finish it first on instance dev (https://dev.example.com) with --label "feature/p1"',
    ]);
  });

  it("names restoring the source definition when it is gone", () => {
    expect(orphanedPending(journal([receipt]), []).map((p) => p.reason)).toEqual([
      "unfinished delivery no longer has its source definition: restore the definition that was pushed (git) and plan again (docs/guides/recover-interrupted-delivery.md)",
    ]);
  });

  it("names recovery for a delivery left in another update set", () => {
    expect(new PendingDeliveryTargetError(SI_UNIT, "dev").hint).toBe(
      'finish it in its original update set first: snagentic plan-push --instance dev --recover-pending; if that refuses, keep the push journal and see "When nothing finishes the delivery" in docs/guides/recover-interrupted-delivery.md',
    );
  });

  it("never names a reconcile command, which does not exist", async () => {
    const all = [
      ...(await reasons(journal([receipt]), "complete")),
      ...(await reasons(journal(undefined, 1), "in progress")),
      ...(await reasons(journal([receipt]), "in progress", "other")),
      ...orphanedPending(journal([receipt]), []).map((p) => p.reason),
      new PendingDeliveryTargetError(SI_UNIT, "dev").hint,
    ];
    for (const text of all) expect(text).not.toMatch(/reconcil/i);
  });
});
