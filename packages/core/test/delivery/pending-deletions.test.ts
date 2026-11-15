import { describe, expect, it } from "bun:test";
import {
  type BuiltUnit,
  computeUnitPlan,
  type PendingDelivery,
  pushUnits,
  unitDigest,
} from "@snagentic/core";
import { pendingFor } from "../../src/authoring/domain/pending-delivery";
import { QUERY, SI_ID, SI_UNIT, unitSetup, VERSION } from "./unit-fixture";

const OTHER = "b".repeat(32);
const deletion = (id: string): BuiltUnit => ({
  updateName: `sys_script_include_${id}`,
  file: `sys_script_include_${id}.xml`,
  head: {
    table: "sys_script_include",
    sysId: id,
    action: "DELETE",
    fields: { sys_id: id },
    referenceNames: {},
  },
  children: [],
});
const receipt = (unit: BuiltUnit): PendingDelivery => ({
  project: "source/x_app",
  updateName: unit.updateName,
  digest: unitDigest(unit),
  updateSet: "s2",
  before: VERSION,
  operation: "delete",
  removes: unit.updateName,
});

describe("pending deletions keep their record identity", () => {
  it("prefers the exact update name and never borrows a receipt for another deletion by ID", () => {
    const first = receipt(deletion(SI_ID));
    const second = receipt(deletion(OTHER));
    expect(pendingFor([first, second], deletion(OTHER), second.digest)).toBe(second);
    expect(pendingFor([first, second], deletion("c".repeat(32)), second.digest)).toBeUndefined();
  });

  it("persists both deletion intents before loading two records from the same table", async () => {
    const context = unitSetup();
    context.tables["sys_script_include"]?.push({
      ...context.tables["sys_script_include"]?.[0],
      sys_id: OTHER,
      name: "Other",
      sys_update_name: `sys_script_include_${OTHER}`,
    });
    context.builds.set(context.project.path, [deletion(SI_ID), deletion(OTHER)]);
    const load = context.deps.installer.load;
    const deps = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        load: async (...args: Parameters<typeof load>) => {
          expect((await context.journal.read())?.pending?.map((entry) => entry.updateName)).toEqual(
            [SI_UNIT, `sys_script_include_${OTHER}`],
          );
          await load(...args);
        },
      },
    };
    const { plan } = await computeUnitPlan(deps, QUERY);
    const result = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 0, notCaptured: 0 });
    expect(await context.journal.read()).toBeNull();
  });

  it("blocks an orphaned receipt rather than pairing it with another deletion from the table", async () => {
    const context = unitSetup();
    context.builds.set(context.project.path, [deletion(SI_ID)]);
    await context.journal.write({
      planId: "old",
      mirrorCommit: "",
      startedAt: "old",
      instance: "dev",
      url: context.deps.url,
      label: "feature/p1",
      pending: [receipt(deletion(OTHER))],
      preferences: [],
      steps: [],
    });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.ready).toBe(false);
    expect(
      plan.problems.some((problem) => problem.reason.includes("no longer has its source")),
    ).toBe(true);
  });
});
