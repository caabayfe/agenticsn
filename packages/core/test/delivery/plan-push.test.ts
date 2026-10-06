import { describe, expect, it } from "bun:test";
import { computePlan } from "@snagentic/core";
import { NEW, RULE, record, setup } from "../support/delivery-fixture";

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
