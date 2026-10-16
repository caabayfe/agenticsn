import { describe, expect, it } from "bun:test";
import {
  computeUnitPlan,
  PlanChangedError,
  PushConfirmationRequiredError,
  pushUnits,
  RecordChangedOnInstanceError,
} from "@snagentic/core";
import { QUERY, SCOPE_ID, SI_UNIT, saveOnInstance, unitSetup } from "./unit-fixture";

async function planned(options: Parameters<typeof unitSetup>[0] = { source: "Edited in source." }) {
  const context = unitSetup(options);
  const { plan } = await computeUnitPlan(context.deps, QUERY);
  return { ...context, plan };
}

describe("push on built units (ADR-0031 item 4)", () => {
  it("loads the plan into the scope's update set, checks capture and content, and commits the ledger", async () => {
    const { deps, plan, tables, calls, authoring, state, project } = await planned();
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    const scoped = tables["sys_update_set"]?.find(
      (s) => s["name"] === "snagentic: feature/p1 [x_app]",
    );
    expect(scoped?.["application"]).toBe(SCOPE_ID);
    expect(calls.filter((c) => c.startsWith("load"))).toEqual([
      `load ${SCOPE_ID} ${SI_UNIT}.xml into ${scoped?.["sys_id"]}`,
    ]);
    expect(result.units).toEqual([
      {
        project: "source/x_app",
        updateName: SI_UNIT,
        table: "sys_script_include",
        name: "Util",
        operation: "load",
        captured: true,
        applied: true,
      },
    ]);
    expect(result.notCaptured + result.notApplied).toBe(0);
    expect(state.commits).toEqual([
      {
        paths: ["source/x_app/snagentic.ledger.yaml"],
        message: `chore(snagentic): ledger after push ${plan.planId} to dev`,
      },
    ]);
    expect(authoring.ledgers.get(project.path)?.get("dev")?.get(SI_UNIT)?.instance).toBe(
      "2|2026-10-16 12:00:00",
    );
    expect(result.ledgerCommit).toBe("commit-1");
    expect(tables["sys_user_preference"]?.every((p) => p["value"] === "")).toBe(true);
  });

  it("leaves nothing to push afterwards: the ledger says source and instance agree", async () => {
    const { deps, plan } = await planned();
    await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    const after = await computeUnitPlan(deps, QUERY);
    expect(after.plan.units).toEqual([]);
    expect(after.plan.problems).toEqual([]);
  });

  it("refuses without confirmation, and when the plan changed since it was reviewed", async () => {
    const { deps, plan, tables } = await planned();
    await expect(
      pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: false }),
    ).rejects.toBeInstanceOf(PushConfirmationRequiredError);
    saveOnInstance(tables, { sys_updated_on: "2026-10-16 09:00:00" });
    await expect(
      pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toBeInstanceOf(PlanChangedError);
  });

  it("loads nothing when the instance moves between plan and load", async () => {
    const { deps, plan, calls } = await planned();
    // Push recomputes the plan (one listing: a page and the empty page that ends it), then reads
    // the unit again just before its load: someone saved it in between.
    let reads = 0;
    const query: typeof deps.reader.query = async (request, signal) => {
      const rows = await deps.reader.query(request, signal);
      const unit = String(request.table) === "sys_script_include";
      if (unit) reads += 1;
      return unit && reads > 2 ? rows.map((row) => ({ ...row, sys_mod_count: "5" })) : rows;
    };
    const moving = { ...deps, reader: { ...deps.reader, query } };
    await expect(
      pushUnits(moving, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toBeInstanceOf(RecordChangedOnInstanceError);
    expect(calls.filter((c) => c.startsWith("load"))).toEqual([]);
  });
});
