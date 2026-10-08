import { describe, expect, it } from "bun:test";
import { computePlan } from "@snagentic/core";
import { NEW, RULE, record, setup } from "../support/delivery-fixture";

const QUERY = { instance: "dev", allowCollisions: false };

describe("computePlan", () => {
  it("refuses a label that would change the update set query", async () => {
    for (const label of ["x^NQname=other", "x\ny", "x]"]) {
      await expect(computePlan(setup().deps, { ...QUERY, label })).rejects.toMatchObject({
        code: "invalid-input",
      });
    }
  });

  it("plans the changed fields of an edited record, ready to push", async () => {
    const { plan, writes } = await computePlan(setup().deps, QUERY);
    expect(plan).toMatchObject({
      instance: "dev",
      mirrorCommit: "c0ffee",
      label: "feature/p1",
      updateSets: ["snagentic: feature/p1"],
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

  it("plans an edit to a record the mirror names differently as an update, not a create", async () => {
    // Created here as util--<id>, pushed, then pulled back under the name the platform gave it.
    const id = "fedcba9876543210fedcba9876543210";
    const pulled = `global/sys_script_include/escalation-helpers--${id}`;
    const { plan } = await computePlan(
      setup({
        mirror: {
          ...setup().state.mirror,
          [pulled]: record("sys_script_include", id, { name: "Util", active: "true" }),
        },
        working: { [NEW]: record("sys_script_include", id, { name: "Util", active: "false" }) },
        changed: [`${NEW}.yaml`],
      }).deps,
      QUERY,
    );
    expect(plan.changes).toEqual([
      expect.objectContaining({ operation: "update", path: `${NEW}.yaml`, fields: ["active"] }),
    ]);
  });

  it("plans nothing for a local copy of a record the mirror holds under another name", async () => {
    const id = "fedcba9876543210fedcba9876543210";
    const same = record("sys_script_include", id, { name: "Util" });
    const { plan } = await computePlan(
      setup({
        mirror: {
          ...setup().state.mirror,
          [`global/sys_script_include/escalation-helpers--${id}`]: same,
        },
        working: { [NEW]: same },
        changed: [`${NEW}.yaml`],
      }).deps,
      QUERY,
    );
    expect(plan.changes).toEqual([]);
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

  it("applies only committed waivers, and says when waivers.yaml has uncommitted changes", async () => {
    const risky = record(
      "sys_script",
      "0123456789abcdef0123456789abcdef",
      { name: "Rule", order: "100" },
      "eval(x);",
    );
    const { plan } = await computePlan(
      setup({ working: { [RULE]: risky }, waivers: null, waiversUncommitted: true }).deps,
      QUERY,
    );
    expect(plan.ready).toBe(false);
    expect(plan.gate.waiverProblems).toEqual([
      { index: -1, reason: "waivers.yaml has uncommitted changes; only committed waivers apply" },
    ]);
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

  it("counts every update set of the branch's batch as ours, and no other branch's", async () => {
    const name = "sys_script_0123456789abcdef0123456789abcdef";
    const { deps, tables } = setup({}, [
      { name, update_set: "s3" },
      { name, update_set: "s4" },
    ]);
    tables["sys_update_set"]?.push(
      { sys_id: "s3", name: "snagentic: feature/p1 [x_acme]", state: "in progress" },
      { sys_id: "s4", name: "snagentic: feature/p10", state: "in progress" },
    );
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.collisions.flatMap((c) => c.heldBy.map((h) => h.updateSetName))).toEqual([
      "snagentic: feature/p10",
    ]);
  });

  it("plans the batch, with a child update set for each scope other than global", async () => {
    const scoped = record(
      "sys_script",
      "abcdefabcdefabcdefabcdefabcdefab",
      { name: "Scoped", order: "1" },
      undefined,
      "x_acme",
    );
    const path = "x_acme/sys_script/scoped--abcdefabcdefabcdefabcdefabcdefab";
    const { deps } = setup({
      mirror: { ...setup().state.mirror, [path]: scoped },
      working: {
        ...setup().state.working,
        [path]: record(
          "sys_script",
          "abcdefabcdefabcdefabcdefabcdefab",
          { name: "Scoped", order: "2" },
          undefined,
          "x_acme",
        ),
      },
      changed: [`${RULE}.yaml`, `${path}.yaml`],
    });
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.updateSets).toEqual(["snagentic: feature/p1", "snagentic: feature/p1 [x_acme]"]);
  });

  it("needs a pull, integrated into the branch", async () => {
    await expect(computePlan(setup({ mirror: {} }).deps, QUERY)).rejects.toMatchObject({
      code: "nothing-pulled-yet",
      hint: "run snagentic pull dev, then snagentic integrate dev",
    });
    await expect(computePlan(setup({ integrated: false }).deps, QUERY)).rejects.toMatchObject({
      code: "mirror-not-integrated",
      hint: "run snagentic integrate dev, resolve any conflicts, then plan again",
    });
  });

  it("is not ready while a push that stopped part way is not pulled back yet", async () => {
    const stopped = {
      planId: "p1",
      mirrorCommit: "c0ffee",
      startedAt: "t",
      preference: null,
      steps: [],
    };
    const { plan } = await computePlan(setup({ journal: stopped }).deps, QUERY);
    expect(plan.ready).toBe(false);
    expect(plan.problems).toContainEqual({
      path: "",
      reason:
        "push p1 stopped part way: run snagentic pull dev, then integrate, before planning again",
    });
    const pulled = await computePlan(
      setup({ journal: { ...stopped, mirrorCommit: "old" } }).deps,
      QUERY,
    );
    expect(pulled.plan.ready).toBe(true);
  });

  it("is not ready when nothing changed", async () => {
    const { plan } = await computePlan(setup({ changed: [] }).deps, QUERY);
    expect(plan).toMatchObject({ changes: [], ready: false });
  });
});
