import { describe, expect, it } from "bun:test";
import { computeUnitPlan, unitDigest, unitPlanId } from "@snagentic/core";
import {
  QUERY,
  SCOPE_ID,
  SI_UNIT,
  saveOnInstance,
  scriptInclude,
  unitSetup,
  VERSION,
} from "./unit-fixture";

describe("plan on built units (ADR-0031, ADR-0033)", () => {
  it("has nothing to push when source and instance still agree", async () => {
    const { deps } = unitSetup();
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(plan.ready).toBe(false);
  });

  it("loads an edited unit into the scope's update set, naming what changes", async () => {
    const { deps } = unitSetup({ source: "Edited in source." });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units).toMatchObject([
      {
        project: "source/x_app",
        scope: "x_app",
        scopeId: SCOPE_ID,
        updateName: SI_UNIT,
        operation: "load",
        changes: ["sys_script_include.description"],
        ledger: VERSION,
        version: VERSION,
      },
    ]);
    expect(plan.updateSets).toEqual(["snagentic: feature/p1", "snagentic: feature/p1 [x_app]"]);
    expect(plan.ready).toBe(true);
    expect((await computeUnitPlan(deps, QUERY)).plan.planId).toBe(plan.planId);
  });

  it("refuses a unit someone changed on the instance since it agreed with source", async () => {
    const { deps, tables } = unitSetup({ source: "Edited in source." });
    saveOnInstance(tables, { description: "Edited there.", sys_mod_count: "2" });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units).toEqual([]);
    expect(plan.problems).toMatchObject([{ updateName: SI_UNIT, kind: "drift" }]);
    expect(plan.ready).toBe(false);
  });

  it("refuses to overwrite a unit this branch never adopted", async () => {
    const { deps } = unitSetup({ source: "Edited in source.", ledger: null });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toMatchObject([{ updateName: SI_UNIT, kind: "not-adopted" }]);
  });

  it("creates a unit the instance does not hold", async () => {
    const { deps, builds, project } = unitSetup();
    const created = scriptInclude("New.", "b".repeat(32));
    builds.set(project.path, [...(builds.get(project.path) ?? []), created]);
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units).toMatchObject([
      { updateName: created.updateName, operation: "create", version: null },
    ]);
    expect(plan.ready).toBe(true);
  });

  it("refuses a definition removed with no Now.del: the instance would keep it", async () => {
    const { deps, builds, project } = unitSetup();
    builds.set(project.path, []);
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toMatchObject([{ updateName: SI_UNIT, kind: "removed" }]);
  });

  it("records a unit the instance already holds as built, without loading it", async () => {
    const { deps } = unitSetup({ source: "Same on both.", instance: "Same on both." });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units).toMatchObject([{ updateName: SI_UNIT, operation: "record" }]);
  });

  it("refuses to plan while source has changes not committed", async () => {
    const { deps, state } = unitSetup({ source: "Edited in source." });
    state.uncommittedSource = ["source/x_app/src/fluent/si.now.ts"];
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toMatchObject([
      { kind: "build", reason: expect.stringContaining("commit the source") },
    ]);
    expect(plan.ready).toBe(false);
  });

  it("gives another plan id once the instance saves the unit", async () => {
    const { deps, tables } = unitSetup({ source: "Edited in source." });
    const first = (await computeUnitPlan(deps, QUERY)).plan.planId;
    saveOnInstance(tables, { sys_updated_on: "2026-10-16 09:00:00" });
    expect((await computeUnitPlan(deps, QUERY)).plan.planId).not.toBe(first);
    expect(unitDigest(scriptInclude("x"))).toHaveLength(32);
  });
});

describe("unitPlanId", () => {
  it("changes with the gate's blocking and waived findings", () => {
    const finding = {
      ruleId: "SN-SEC-001",
      severity: "block" as const,
      path: "p",
      line: 1,
      message: "m",
    };
    const gate = { passed: true, blocking: [], waived: [], warnings: 0, waiverProblems: [] };
    const blocked = { ...gate, passed: false, blocking: [finding] };
    const waived = { ...gate, waived: [{ ...finding, reason: "r", approver: "pat" }] };
    const ids = new Set([unitPlanId([], gate), unitPlanId([], blocked), unitPlanId([], waived)]);
    expect(ids.size).toBe(3);
  });
});
