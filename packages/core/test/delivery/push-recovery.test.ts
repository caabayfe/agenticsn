import { describe, expect, it } from "bun:test";
import {
  computeUnitPlan,
  pushUnits,
  type UnitPushDependencies,
  withEntries,
} from "@snagentic/core";
import { FLOW_NAME, flowSetup } from "./flow-fixture";
import { QUERY, SI_UNIT, saveOnInstance, unitSetup } from "./unit-fixture";

async function push(deps: UnitPushDependencies) {
  const { plan } = await computeUnitPlan(deps, QUERY);
  return pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
}

async function uncaptured() {
  const context = unitSetup({ source: "Changed in source." });
  const load = context.deps.installer.load;
  await push({
    ...context.deps,
    installer: {
      ...context.deps.installer,
      load: async (...args) => {
        await load(...args);
        context.tables["sys_update_xml"] = [];
      },
    },
  });
  return context;
}

describe("unfinished delivery", () => {
  it("reconciles a verified deletion even when the SDK regenerates its synthetic update name", async () => {
    const context = unitSetup();
    const deletion = (id: string) => ({
      updateName: `sys_script_include_${id}`,
      file: `sys_script_include_${id}.xml`,
      head: {
        table: "sys_script_include",
        sysId: id,
        action: "DELETE" as const,
        fields: { sys_id: id, name: "Util" },
        referenceNames: {},
      },
      children: [],
    });
    context.builds.set(context.project.path, [deletion("d".repeat(32))]);
    await expect(
      push({
        ...context.deps,
        workspace: {
          ...context.deps.workspace,
          commitFiles: async () => {
            throw new Error("git failed");
          },
        },
      }),
    ).resolves.toMatchObject({
      ledgerCommit: null,
      warnings: [expect.stringContaining("git failed")],
    });
    context.builds.set(context.project.path, [deletion("e".repeat(32))]);
    const before = context.calls.filter((call) => call.startsWith("load")).length;
    const result = await push(context.deps);
    expect(result).toMatchObject({ notApplied: 0, notCaptured: 0 });
    expect(context.calls.filter((call) => call.startsWith("load"))).toHaveLength(before);
    expect(await context.journal.read()).toBeNull();
  });

  it("keeps preferences journaled when restoration fails and restores them on the next push", async () => {
    const context = unitSetup({ source: "Changed" });
    const update = context.deps.writer.update;
    await expect(
      push({
        ...context.deps,
        writer: {
          ...context.deps.writer,
          update: async (table, id, values, signal) => {
            if (table === "sys_user_preference" && values["value"] === "")
              throw new Error("restore failed");
            return update(table, id, values, signal);
          },
        },
      }),
    ).rejects.toThrow("restore failed");
    expect((await context.journal.read())?.preferences.length).toBeGreaterThan(0);
    await push(context.deps);
    expect(await context.journal.read()).toBeNull();
    expect(
      context.tables["sys_user_preference"]?.every((preference) => preference["value"] === ""),
    ).toBe(true);
  });

  it("blocks missing or closed original update sets", async () => {
    const context = await uncaptured();
    const id = (await context.journal.read())?.pending?.[0]?.updateSet;
    context.tables["sys_update_set"] = (context.tables["sys_update_set"] ?? []).map((set) =>
      set["sys_id"] === id ? { ...set, state: "complete" } : set,
    );
    expect(
      (await computeUnitPlan(context.deps, QUERY)).plan.problems.some((p) =>
        p.reason.includes("missing or closed"),
      ),
    ).toBe(true);
    context.tables["sys_update_set"] = (context.tables["sys_update_set"] ?? []).filter(
      (set) => set["sys_id"] !== id,
    );
    expect((await computeUnitPlan(context.deps, QUERY)).plan.ready).toBe(false);
  });

  it("refuses to redirect pending work into a replacement update set", async () => {
    const context = await uncaptured();
    const id = (await context.journal.read())?.pending?.[0]?.updateSet;
    context.tables["sys_update_set"] = (context.tables["sys_update_set"] ?? []).map((set) =>
      set["sys_id"] === id ? { ...set, name: "Renamed" } : set,
    );
    const before = context.calls.filter((call) => call.startsWith("load")).length;
    await expect(push(context.deps)).rejects.toMatchObject({ code: "pending-delivery-target" });
    expect(context.calls.filter((call) => call.startsWith("load"))).toHaveLength(before);
    expect(await context.journal.read()).not.toBeNull();
  });

  it("retries capture only through a new reviewed plan, then clears the journal after commit", async () => {
    const context = await uncaptured();
    const before = context.authoring.ledgers.get(context.project.path)?.get("dev")?.get(SI_UNIT);
    expect(before?.instance).toBe("1|2026-10-16 06:30:48");
    const { plan } = await computeUnitPlan({ ...context.deps }, QUERY);
    expect(plan.units).toMatchObject([{ operation: "load", version: "2|2026-10-16 12:00:00" }]);
    const calls = context.calls.length;
    await expect(
      pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: false }),
    ).rejects.toMatchObject({ code: "push-confirmation-required" });
    expect(context.calls.length).toBe(calls);
    const result = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notCaptured: 0, notApplied: 0 });
    expect(await context.journal.read()).toBeNull();
    expect((await computeUnitPlan(context.deps, QUERY)).plan.units).toEqual([]);
  });

  it("blocks a retry when someone edits the remote after read-back", async () => {
    const context = await uncaptured();
    saveOnInstance(context.tables, { description: "Someone else's edit", sys_mod_count: "3" });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.ready).toBe(false);
    expect(plan.problems).toContainEqual(
      expect.objectContaining({
        kind: "unsafe",
        reason: expect.stringContaining("instance changed"),
      }),
    );
    const before = [...context.calls];
    await expect(
      pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toMatchObject({ code: "plan-not-ready" });
    expect(context.calls).toEqual(before);
  });

  it("keeps a missing capture pending even when a legacy ledger already says delivered", async () => {
    const context = await uncaptured();
    const journal = await context.journal.read();
    const entry = journal?.pending?.[0];
    if (entry === undefined) throw new Error("no receipt");
    context.authoring.ledgers.set(
      context.project.path,
      withEntries(
        new Map(),
        "dev",
        new Map([[SI_UNIT, { build: entry.digest, instance: entry.observed ?? "", losses: [] }]]),
      ),
    );
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units).toMatchObject([{ updateName: SI_UNIT, operation: "load" }]);
  });

  it("blocks changed source, missing definitions and a different instance URL or batch", async () => {
    const context = await uncaptured();
    for (const [deps, query] of [
      [{ ...context.deps, url: "https://other.example.com" }, QUERY],
      [context.deps, { ...QUERY, label: "other" }],
    ] as const) {
      expect((await computeUnitPlan(deps, query)).plan).toMatchObject({
        ready: false,
        problems: [expect.objectContaining({ kind: "unsafe" })],
      });
    }
    const unit = context.builds.get(context.project.path)?.[0];
    if (unit === undefined) throw new Error("no unit");
    context.builds.set(context.project.path, [
      {
        ...unit,
        head: { ...unit.head, fields: { ...unit.head.fields, description: "Changed again" } },
      },
    ]);
    expect(
      (await computeUnitPlan(context.deps, QUERY)).plan.problems.some((p) =>
        p.reason.includes("source changed"),
      ),
    ).toBe(true);
    context.builds.set(context.project.path, []);
    expect(
      (await computeUnitPlan(context.deps, QUERY)).plan.problems.some((p) =>
        p.reason.includes("no longer has its source"),
      ),
    ).toBe(true);
  });

  it("refuses a legacy interrupted load without silently discarding its journal", async () => {
    const context = unitSetup({ source: "Changed" });
    await context.journal.write({
      planId: "old",
      mirrorCommit: "",
      startedAt: "old",
      preferences: [],
      steps: [
        { operation: "load", table: "source", sysId: context.project.path, state: "written" },
      ],
    });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.ready).toBe(false);
    expect(plan.problems[0]?.reason).toContain("legacy interrupted push");
    expect(await context.journal.read()).not.toBeNull();
  });

  it("recovers a failed ledger commit without sending the verified metadata again", async () => {
    const context = unitSetup({ source: "Changed" });
    const deps = {
      ...context.deps,
      workspace: {
        ...context.deps.workspace,
        commitFiles: async () => {
          throw new Error("git failed");
        },
      },
    };
    const result = await push(deps);
    expect(result.ledgerCommit).toBeNull();
    expect(result.warnings).toEqual([expect.stringContaining("git failed")]);
    expect(result.next).toEqual([
      { tool: "plan_push", args: { instance: "dev", label: "feature/p1" } },
    ]);
    expect((await context.journal.read())?.pending).toMatchObject([{ verified: true }]);
    const loadsBefore = context.calls.filter((call) => call.startsWith("load")).length;
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units).toMatchObject([{ operation: "record" }]);
    await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(context.calls.filter((call) => call.startsWith("load")).length).toBe(loadsBefore);
    expect(await context.journal.read()).toBeNull();
  });

  it("rechecks capture before committing a recovered receipt", async () => {
    const context = flowSetup();
    await expect(
      push({
        ...context.deps,
        workspace: {
          ...context.deps.workspace,
          commitFiles: async () => {
            throw new Error("git failed");
          },
        },
      }),
    ).resolves.toMatchObject({
      ledgerCommit: null,
      warnings: [expect.stringContaining("git failed")],
    });
    context.tables["sys_update_xml"] = [];
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units).toMatchObject([{ updateName: FLOW_NAME, operation: "record" }]);
    const result = await pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notApplied: 1, notCaptured: 1, ledgerCommit: null });
    expect((await computeUnitPlan(context.deps, QUERY)).plan.units).toMatchObject([
      { operation: "load" },
    ]);
  });

  it("does not automatically replay a timed-out write and reconciles comparable content", async () => {
    const context = unitSetup({ source: "Changed" });
    const load = context.deps.installer.load;
    await expect(
      push({
        ...context.deps,
        installer: {
          ...context.deps.installer,
          load: async (...args) => {
            await load(...args);
            throw new Error("timeout");
          },
        },
      }),
    ).rejects.toThrow("timeout");
    expect(context.calls.filter((call) => call.startsWith("load"))).toHaveLength(1);
    expect((await context.journal.read())?.pending).toHaveLength(1);
    expect((await computeUnitPlan(context.deps, QUERY)).plan.units).toMatchObject([
      { operation: "record" },
    ]);
    await push(context.deps);
    expect(context.calls.filter((call) => call.startsWith("load"))).toHaveLength(1);
    expect(await context.journal.read()).toBeNull();
  });
});
