import { describe, expect, it } from "bun:test";
import {
  computeUnitPlan,
  FlowPublishFailedError,
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
        refused: null,
        mismatches: [],
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

describe("push on built units: deletions, flows, global, recovery", () => {
  const deletion = {
    updateName: `sys_script_include_${"d".repeat(32)}`,
    file: `sys_script_include_${"d".repeat(32)}.xml`,
    head: {
      table: "sys_script_include",
      sysId: "d".repeat(32),
      action: "DELETE" as const,
      fields: { sys_id: "d".repeat(32), name: "Util" },
      referenceNames: {},
    },
    children: [],
  };

  it("deletes the record a Now.del names, and drops its ledger entry", async () => {
    const context = unitSetup();
    context.builds.set(context.project.path, [deletion]);
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units).toMatchObject([{ operation: "delete", removes: SI_UNIT }]);
    expect(plan.problems).toEqual([]);
    const result = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result.units).toMatchObject([{ operation: "delete", applied: true }]);
    expect(context.tables["sys_script_include"]).toEqual([]);
    expect(context.authoring.ledgers.get(context.project.path)?.get("dev")).toBeUndefined();
  });

  it("forgets the ledger entry of a record gone from both source and instance, loading nothing", async () => {
    const context = unitSetup();
    context.builds.set(context.project.path, []);
    context.tables["sys_script_include"] = [];
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    const result = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result.units).toMatchObject([{ operation: "forget", applied: true }]);
    expect(context.calls.filter((c) => c.startsWith("load"))).toEqual([]);
    expect(context.authoring.ledgers.get(context.project.path)?.get("dev")).toBeUndefined();
  });

  it("loads a created record again when the platform set a field its own way on insert", async () => {
    const context = unitSetup({ ledger: null });
    context.tables["sys_script_include"] = [];
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    // As the platform does a new table's label: only the insert sets it its own way.
    const load = context.deps.installer.load;
    let loads = 0;
    const platform = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        load: async (...args: Parameters<typeof load>) => {
          await load(...args);
          loads += 1;
          if (loads === 1) saveOnInstance(context.tables, { description: "Set by the platform." });
        },
      },
    };
    const result = await pushUnits(platform, { ...QUERY, planId: plan.planId, confirm: true });
    expect(loads).toBe(2);
    expect(result.units).toMatchObject([{ operation: "create", captured: true, applied: true }]);
    expect(result.notApplied).toBe(0);
    const after = await computeUnitPlan(context.deps, QUERY);
    expect(after.plan.units).toEqual([]);
  });

  it("records a created record that reads back otherwise, so the next plan loads it again instead of asking for adopt", async () => {
    const context = unitSetup({ ledger: null });
    context.tables["sys_script_include"] = [];
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units).toMatchObject([{ operation: "create" }]);
    // The platform sets a field its own way on every load: the second load does not help.
    const load = context.deps.installer.load;
    const platform = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        load: async (...args: Parameters<typeof load>) => {
          await load(...args);
          saveOnInstance(context.tables, { description: "Set by the platform." });
        },
      },
    };
    const result = await pushUnits(platform, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result.units).toMatchObject([
      {
        operation: "create",
        applied: false,
        mismatches: [
          'sys_script_include.description: built "Helpers.", instance "Set by the platform."',
        ],
      },
    ]);
    const after = await computeUnitPlan(context.deps, QUERY);
    expect(after.plan.problems).toEqual([]);
    expect(after.plan.units).toMatchObject([{ updateName: SI_UNIT, operation: "load" }]);
  });

  const FLOW = "f".repeat(32);
  const flow = {
    updateName: `sys_hub_flow_${FLOW}`,
    file: `sys_hub_flow_${FLOW}.xml`,
    head: {
      table: "sys_hub_flow",
      sysId: FLOW,
      action: "INSERT_OR_UPDATE" as const,
      fields: { sys_id: FLOW, name: "Notify" },
      referenceNames: {},
    },
    children: [],
  };
  const flowXml = `<record_update table="sys_hub_flow"><sys_hub_flow action="INSERT_OR_UPDATE"><sys_id>${FLOW}</sys_id><sys_update_name>sys_hub_flow_${FLOW}</sys_update_name><name>Notify</name><type>flow</type></sys_hub_flow></record_update>`;

  it("publishes the flows it loads, and stops when the instance refuses one", async () => {
    const context = unitSetup();
    context.builds.set(context.project.path, [
      ...(context.builds.get(context.project.path) ?? []),
      flow,
    ]);
    context.xml.set(flow.updateName, flowXml);
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units).toMatchObject([{ updateName: flow.updateName, operation: "create" }]);
    await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(context.calls).toContain(`publish x_app flows=${FLOW}`);

    const refusing = unitSetup();
    refusing.builds.set(refusing.project.path, [
      ...(refusing.builds.get(refusing.project.path) ?? []),
      flow,
    ]);
    refusing.xml.set(flow.updateName, flowXml);
    refusing.refused.add(FLOW);
    const second = await computeUnitPlan(refusing.deps, QUERY);
    await expect(
      pushUnits(refusing.deps, { ...QUERY, planId: second.plan.planId, confirm: true }),
    ).rejects.toBeInstanceOf(FlowPublishFailedError);
  });

  it("pushes global first, into the batch itself", async () => {
    const context = unitSetup({ source: "Edited in source." });
    const global = context.authoring.add("global", "global");
    const property = {
      updateName: `sys_properties_${"e".repeat(32)}`,
      file: `sys_properties_${"e".repeat(32)}.xml`,
      head: {
        table: "sys_properties",
        sysId: "e".repeat(32),
        action: "INSERT_OR_UPDATE" as const,
        fields: { sys_id: "e".repeat(32), name: "x.y", value: "1" },
        referenceNames: {},
      },
      children: [],
    };
    context.builds.set(global.path, [property]);
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    const result = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result.updateSets.map((s) => s.scope)).toEqual(["global", "x_app"]);
    expect(result.updateSets[0]?.sysId).toBe(result.batch.sysId);
    expect(context.calls.filter((c) => c.startsWith("load")).map((c) => c.split(" ")[1])).toEqual([
      "global",
      SCOPE_ID,
    ]);
  });

  it("puts back the preferences a push left switched, before pushing again", async () => {
    const context = unitSetup({ source: "Edited in source." });
    context.tables["sys_user_preference"] = [
      { sys_id: "p1", user: "u1", name: "apps.current_app", value: SCOPE_ID },
    ];
    await context.journal.write({
      planId: "old",
      mirrorCommit: "",
      startedAt: "2026-10-16T10:00:00Z",
      preferences: [{ sysId: "p1", user: "u1", name: "apps.current_app", previousValue: "global" }],
      steps: [],
    });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(
      context.tables["sys_user_preference"]?.find((p) => p["sys_id"] === "p1")?.["value"],
    ).toBe("global");
    expect(await context.journal.read()).toBeNull();
  });
});
