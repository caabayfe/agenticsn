import { describe, expect, it } from "bun:test";
import { computeUnitPlan, pushUnits, type UnitPushDependencies } from "@snagentic/core";
import { FLOW_NAME, flowSetup } from "./flow-fixture";
import { QUERY, SI_UNIT, unitSetup } from "./unit-fixture";

describe("delivery evidence", () => {
  it("does not advance a compiled ledger when live content disagrees with a correct capture", async () => {
    const context = flowSetup();
    const original = context.deps.installer.publish;
    const deps: UnitPushDependencies = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        publish: async (...args) => {
          const results = await original(...args);
          context.tables["sys_hub_flow"] = (context.tables["sys_hub_flow"] ?? []).map((row) => ({
            ...row,
            name: "Different live definition",
          }));
          return results;
        },
      },
    };
    const { plan } = await computeUnitPlan(deps, QUERY);
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 1, notCaptured: 0, ledgerCommit: null });
  });

  it("rejects duplicate and unexpected publication acknowledgements", async () => {
    for (const duplicate of [true, false]) {
      const context = flowSetup();
      const deps: UnitPushDependencies = {
        ...context.deps,
        installer: {
          ...context.deps.installer,
          publish: async (_scope, targets) => {
            const results = targets.flows.map((sysId) => ({
              sysId,
              published: true,
              message: "ok",
            }));
            return [
              ...results,
              {
                sysId: duplicate ? (targets.flows[0] ?? "") : "unexpected",
                published: true,
                message: "ok",
              },
            ];
          },
        },
      };
      const { plan } = await computeUnitPlan(deps, QUERY);
      await expect(
        pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true }),
      ).rejects.toMatchObject({ code: "flow-publish-failed" });
    }
  });

  it("verifies a current published flow and advances its ledger only once", async () => {
    const context = flowSetup();
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    const result = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 0, notCaptured: 0, ledgerCommit: "commit-1" });
    expect(result.units[0]?.mismatches).toEqual([]);
    expect(await context.journal.read()).toBeNull();
    expect((await computeUnitPlan(context.deps, QUERY)).plan.units).toEqual([]);
  });

  it("does not accept a draft capture despite a successful publish acknowledgement", async () => {
    const context = flowSetup();
    const deps: UnitPushDependencies = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        publish: async (_scope, targets) =>
          targets.flows.map((sysId) => ({ sysId, published: true, message: "ok" })),
      },
    };
    const { plan } = await computeUnitPlan(deps, QUERY);
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 1, notCaptured: 1, ledgerCommit: null });
    expect(await context.journal.read()).not.toBeNull();
  });
  it("does not accept an old published capture when the platform skips the new flow", async () => {
    const context = flowSetup();
    const deps = {
      ...context.deps,
      installer: { ...context.deps.installer, load: async () => {} },
    };
    const { plan } = await computeUnitPlan(deps, QUERY);
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 1, notCaptured: 1, ledgerCommit: null });
    expect(result.units[0]?.mismatches).toContain(
      "captured definition does not match the reviewed build, or lacks its published snapshot",
    );
    const next = await computeUnitPlan(deps, QUERY);
    expect(next.plan.units).toMatchObject([{ updateName: FLOW_NAME, operation: "load" }]);
  });

  it("requires an acknowledgement for every requested publication", async () => {
    const context = flowSetup();
    const deps = {
      ...context.deps,
      installer: { ...context.deps.installer, publish: async () => [] },
    };
    const { plan } = await computeUnitPlan(deps, QUERY);
    await expect(
      pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toMatchObject({ code: "flow-publish-failed" });
    expect(await context.journal.read()).not.toBeNull();
  });

  it("keeps applied but uncaptured changes pending across a fresh plan", async () => {
    const context = unitSetup({ source: "Changed in source." });
    const original = context.deps.installer.load;
    const deps = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        load: async (...args: Parameters<typeof original>) => {
          await original(...args);
          context.tables["sys_update_xml"] = [];
        },
      },
    };
    const { plan } = await computeUnitPlan(deps, QUERY);
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 0, notCaptured: 1 });
    expect(await context.journal.read()).not.toBeNull();
    const next = await computeUnitPlan(deps, QUERY);
    expect(next.plan.units).toContainEqual(expect.objectContaining({ updateName: SI_UNIT }));
    expect(next.plan.problems).toEqual([]);
  });
});
