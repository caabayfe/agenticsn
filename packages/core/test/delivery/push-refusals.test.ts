import { describe, expect, it } from "bun:test";
import { computeUnitPlan, pushUnits } from "@snagentic/core";
import { QUERY, SI_ID, unitSetup } from "./unit-fixture";

// A record the platform skips during fluent/load: the load still answers with its update set,
// and the system log alone says why (pdi3, 2026-10-23, Performance Analytics indicators).

const skipped = (sysId: string, reason: string) => ({
  sys_id: `log-${sysId}`,
  sys_created_on: "2999-01-01 00:00:00",
  level: "2",
  source: "com.glide.ui.ServletErrorListener",
  message: `Skipping record for table sys_script_include and id ${sysId} - ${reason}: no thrown error`,
});

function refusingSetup(log: readonly Record<string, string>[]) {
  const context = unitSetup({ source: "Edited in source." });
  const load = context.deps.installer.load;
  context.deps = {
    ...context.deps,
    installer: {
      ...context.deps.installer,
      // The platform answers as for any load, writes nothing, and logs why.
      load: async (scopeId, files, updateSet, signal) => {
        if (log.length === 0) return load(scopeId, files, updateSet, signal);
        context.tables["syslog"] = [...log];
      },
    },
  };
  return context;
}

describe("records the platform skips during a push", () => {
  it("names the platform's reason and the action that unblocks them", async () => {
    const context = refusingSetup([
      skipped(SI_ID, "permission denied"),
      skipped("f".repeat(32), "permission denied"),
    ]);
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    const pushed = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(pushed.units[0]).toMatchObject({
      captured: false,
      applied: false,
      refused: "permission denied",
    });
    expect(pushed.refused).toEqual([
      {
        table: "sys_script_include",
        reason: "permission denied",
        records: ["Util"],
        action:
          "an access rule on sys_script_include does not let admin create these records: give admin the role its create rules need, or the plugin a rule's script checks, then run the same command again",
      },
    ]);
  });

  it("reads no log when every record arrived", async () => {
    const context = refusingSetup([]);
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    const pushed = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(pushed.units[0]).toMatchObject({ applied: true, refused: null });
    expect(pushed.refused).toEqual([]);
    expect(context.fake.queries.some((q) => q.table === "syslog")).toBe(false);
  });
});
