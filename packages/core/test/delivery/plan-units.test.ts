import { describe, expect, it } from "bun:test";
import { computeUnitPlan, deletionFor, unitDigest, unitPlanId } from "@snagentic/core";
import { governanceOf, unitOf } from "../support/fake-governance";
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

  it("names the Now.del that deletes a removed definition (B2)", async () => {
    const { deps, builds, project } = unitSetup();
    builds.set(project.path, []);
    const { plan } = await computeUnitPlan(deps, QUERY);
    const id = SI_UNIT.slice(-32);
    expect(plan.problems[0]?.reason).toContain(`Now.del('sys_script_include', '${id}')`);
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

// A removed child of a typed array (a UI action's role) is its own unit: the SDK emits no
// deletion, so the plan names the line that deletes it (spec 009 B2).
describe("deletionFor", () => {
  const id = "0123456789abcdef0123456789abcdef";

  it("names the table and sys_id of a record unit", () => {
    expect(deletionFor(`sys_ui_action_role_${id}`)).toBe(`Now.del('sys_ui_action_role', '${id}')`);
  });

  it("names nothing for a unit named by its keys", () => {
    expect(deletionFor("sys_dictionary_x_app_task_u_status")).toBeNull();
  });
});

// Decision D (2026-10-17): the gate judges what the change introduced since the project last
// agreed with the instance (its ledger commit), so adopted code doesn't block unrelated pushes.
describe("plan's gate on adopted code", () => {
  const legacy = unitOf("sys_script_include", {
    description: "Baseline helper",
    script: "eval(a); /*SN-SEC-001*/",
  });

  it("doesn't block on what an adopted project already held", async () => {
    const { deps, project } = unitSetup();
    const governance = governanceOf({
      [project.path]: { now: [legacy], base: null, at: { adopted: [legacy] } },
    });
    const workspace = { ...deps.authoring.workspace, ledgerCommit: async () => "adopted" };
    const { plan } = await computeUnitPlan(
      { ...deps, governance, authoring: { ...deps.authoring, workspace } },
      QUERY,
    );
    expect(plan.gate.passed).toBe(true);
  });

  it("blocks a project never pushed even when its source was committed before the base", async () => {
    // A workspace with no pull judges from HEAD, where committed source is already there.
    const { deps, project, builds } = unitSetup({ ledger: null });
    builds.set(project.path, [scriptInclude("New.", "b".repeat(32))]);
    const governance = governanceOf({
      [project.path]: { now: [legacy], base: [legacy], unchanged: true },
    });
    const workspace = { ...deps.authoring.workspace, ledgerCommit: async () => null };
    const { plan } = await computeUnitPlan(
      { ...deps, governance, authoring: { ...deps.authoring, workspace } },
      QUERY,
    );
    expect(plan.units.map((u) => u.operation)).toEqual(["create"]);
    expect(plan.gate.passed).toBe(false);
    expect(plan.ready).toBe(false);
  });

  it("judges a pushed project from its ledger even when the change since the base left it", async () => {
    const { deps, project } = unitSetup({ source: "Edited in source." });
    const governance = governanceOf({
      [project.path]: { now: [legacy], base: [legacy], unchanged: true, at: { pushed: [] } },
    });
    const workspace = { ...deps.authoring.workspace, ledgerCommit: async () => "pushed" };
    const { plan } = await computeUnitPlan(
      { ...deps, governance, authoring: { ...deps.authoring, workspace } },
      QUERY,
    );
    expect(plan.units.map((u) => u.operation)).toEqual(["load"]);
    expect(plan.gate.passed).toBe(false);
  });

  it("still blocks a project with no ledger on everything it holds", async () => {
    const { deps, project } = unitSetup();
    const governance = governanceOf({ [project.path]: { now: [legacy], base: null } });
    const { plan } = await computeUnitPlan({ ...deps, governance }, QUERY);
    expect(plan.gate.passed).toBe(false);
  });
});
