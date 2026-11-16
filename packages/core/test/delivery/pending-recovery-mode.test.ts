import { describe, expect, it } from "bun:test";
import { type BuiltUnit, computeUnitPlan, pushUnits, unitDigest } from "@snagentic/core";
import { QUERY, scriptInclude, unitSetup } from "./unit-fixture";

const ID = "d".repeat(32);
const NAME = `sys_decision_${ID}`;
const RECOVERY = { ...QUERY, recoverPending: true };
const withoutUnsupported = (fields: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(fields).filter(([field]) => field !== "execution"));
const decision = (unsupported: boolean): BuiltUnit => ({
  updateName: NAME,
  file: `${NAME}.xml`,
  head: {
    table: "sys_decision",
    sysId: ID,
    action: "INSERT_OR_UPDATE",
    fields: {
      sys_id: ID,
      name: "ACC incident offering",
      active: "true",
      ...(unsupported ? { execution: "all" } : {}),
    },
    referenceNames: {},
  },
  children: [],
});

async function stopped() {
  const c = unitSetup({ ledger: null });
  c.builds.set(c.project.path, [decision(true)]);
  const load = c.deps.installer.load;
  const deps = {
    ...c.deps,
    installer: {
      ...c.deps.installer,
      load: async (...args: Parameters<typeof load>) => {
        await load(...args);
        c.tables["sys_decision"] = (c.tables["sys_decision"] ?? []).map(withoutUnsupported);
        for (const [key, capture] of c.payloads) {
          if (capture.unit.updateName !== NAME) continue;
          const unit = capture.unit;
          c.payloads.set(key, {
            ...capture,
            unit: { ...unit, head: { ...unit.head, fields: withoutUnsupported(unit.head.fields) } },
          });
        }
      },
    },
  };
  const original = { ...QUERY, label: "original quality batch" };
  const { plan } = await computeUnitPlan(deps, original);
  const first = await pushUnits(deps, { ...original, planId: plan.planId, confirm: true });
  expect(first).toMatchObject({ notCaptured: 1, notApplied: 0 });
  c.builds.set(c.project.path, [decision(false)]);
  return c;
}

describe("explicit recovery of pending delivery receipts", () => {
  it("records corrected source only after capture/live proof, excluding unrelated changes and loading nothing", async () => {
    const c = await stopped();
    const journal = await c.journal.read();
    c.builds.set(c.project.path, [decision(false), scriptInclude("Unrelated", "e".repeat(32))]);
    expect((await computeUnitPlan(c.deps, QUERY)).plan.ready).toBe(false);
    const before = [...c.calls];
    const { plan } = await computeUnitPlan(c.deps, RECOVERY);
    expect(plan).toMatchObject({
      ready: true,
      label: journal?.label,
      units: [{ updateName: NAME, operation: "record" }],
    });
    expect(plan.units).toHaveLength(1);
    expect(plan.next[0]?.args).toMatchObject({ recoverPending: true });
    expect(c.calls).toEqual(before);
    expect(await c.journal.read()).toEqual(journal);
    await expect(
      pushUnits(c.deps, { ...RECOVERY, planId: plan.planId, confirm: false }),
    ).rejects.toMatchObject({ code: "push-confirmation-required" });
    const loads = c.calls.filter((call) => call.startsWith("load")).length;
    const result = await pushUnits(c.deps, { ...RECOVERY, planId: plan.planId, confirm: true });
    expect(result).toMatchObject({ notCaptured: 0, notApplied: 0 });
    expect(c.calls.filter((call) => call.startsWith("load"))).toHaveLength(loads);
    expect(await c.journal.read()).toBeNull();
    expect(c.authoring.ledgers.get(c.project.path)?.get("dev")?.get(NAME)?.build).toBe(
      unitDigest(decision(false)),
    );
    expect((await computeUnitPlan(c.deps, QUERY)).plan.units).toMatchObject([
      { operation: "create" },
    ]);
  });

  const defects: Record<string, (c: Awaited<ReturnType<typeof stopped>>) => void> = {
    "missing capture": (c) => {
      c.tables["sys_update_xml"] = [];
    },
    "wrong capture": (c) => {
      for (const [key, value] of c.payloads)
        c.payloads.set(key, {
          ...value,
          unit: {
            ...value.unit,
            head: { ...value.unit.head, fields: { ...value.unit.head.fields, name: "Different" } },
          },
        });
    },
    "live mismatch": (c) => {
      c.tables["sys_decision"] = (c.tables["sys_decision"] ?? []).map((row) => ({
        ...row,
        name: "Different",
      }));
    },
    "changed version": (c) => {
      c.tables["sys_decision"] = (c.tables["sys_decision"] ?? []).map((row) => ({
        ...row,
        sys_mod_count: "9",
      }));
    },
    "closed set": (c) => {
      c.tables["sys_update_set"] = (c.tables["sys_update_set"] ?? []).map((row) => ({
        ...row,
        state: "complete",
      }));
    },
    "renamed set": (c) => {
      c.tables["sys_update_set"] = (c.tables["sys_update_set"] ?? []).map((row) => ({
        ...row,
        name: "Different",
      }));
    },
    "missing source": (c) => {
      c.builds.set(c.project.path, []);
    },
  };
  for (const [defect, damage] of Object.entries(defects)) {
    it(`refuses ${defect} and preserves the original journal`, async () => {
      const c = await stopped();
      damage(c);
      const journal = await c.journal.read();
      const before = [...c.calls];
      const { plan } = await computeUnitPlan(c.deps, RECOVERY);
      expect(plan.ready).toBe(false);
      expect(plan.problems.length).toBeGreaterThan(0);
      await expect(
        pushUnits(c.deps, { ...RECOVERY, planId: plan.planId, confirm: true }),
      ).rejects.toMatchObject({ code: "plan-not-ready" });
      expect(c.calls).toEqual(before);
      expect(await c.journal.read()).toEqual(journal);
    });
  }

  it("cannot redirect a receipt to another URL, alias or batch", async () => {
    const c = await stopped();
    for (const [deps, query] of [
      [{ ...c.deps, url: "https://other.example.com" }, RECOVERY],
      [c.deps, { ...RECOVERY, instance: "other" }],
      [c.deps, { ...RECOVERY, label: "other" }],
    ] as const)
      expect((await computeUnitPlan(deps, query)).plan).toMatchObject({
        ready: false,
        problems: expect.arrayContaining([expect.objectContaining({ kind: "unsafe" })]),
      });
  });

  it("has no recovery plan without a pending receipt", async () => {
    const c = unitSetup({ source: "New work" });
    expect((await computeUnitPlan(c.deps, RECOVERY)).plan).toMatchObject({
      ready: false,
      units: [],
      problems: expect.arrayContaining([expect.objectContaining({ kind: "unsafe" })]),
    });
  });

  it("keeps the receipt when the ledger commit fails, then rechecks it without replaying the load", async () => {
    const c = await stopped();
    const deps = {
      ...c.deps,
      workspace: {
        ...c.deps.workspace,
        commitFiles: async () => {
          throw new Error("git failed");
        },
      },
    };
    const { plan } = await computeUnitPlan(deps, RECOVERY);
    const loads = c.calls.filter((call) => call.startsWith("load")).length;
    expect(
      await pushUnits(deps, { ...RECOVERY, planId: plan.planId, confirm: true }),
    ).toMatchObject({ ledgerCommit: null });
    expect(await c.journal.read()).not.toBeNull();
    const again = await computeUnitPlan(c.deps, RECOVERY);
    await pushUnits(c.deps, { ...RECOVERY, planId: again.plan.planId, confirm: true });
    expect(await c.journal.read()).toBeNull();
    expect(c.calls.filter((call) => call.startsWith("load"))).toHaveLength(loads);
  });

  it("rechecks capture at confirmation and never accepts a stale reviewed plan", async () => {
    const c = await stopped();
    const { plan } = await computeUnitPlan(c.deps, RECOVERY);
    c.tables["sys_update_xml"] = [];
    const before = [...c.calls];
    await expect(
      pushUnits(c.deps, { ...RECOVERY, planId: plan.planId, confirm: true }),
    ).rejects.toMatchObject({ code: "plan-changed" });
    expect(c.calls).toEqual(before);
    expect(await c.journal.read()).not.toBeNull();
  });

  it("binds recovery mode into the reviewed plan even when normal planning would record the same receipt", async () => {
    const c = await stopped();
    const journal = await c.journal.read();
    if (journal === null) throw new Error("no journal");
    await c.journal.write({
      ...journal,
      pending:
        journal.pending?.map((entry) => ({ ...entry, digest: unitDigest(decision(false)) })) ?? [],
    });
    if (journal.label === undefined) throw new Error("no original label");
    const normalQuery = { ...QUERY, label: journal.label };
    const normal = (await computeUnitPlan(c.deps, normalQuery)).plan;
    const recovered = (await computeUnitPlan(c.deps, RECOVERY)).plan;
    expect(normal.ready).toBe(true);
    expect(recovered.ready).toBe(true);
    expect(normal.units).toEqual(recovered.units);
    expect(normal.planId).not.toBe(recovered.planId);
    await expect(
      pushUnits(c.deps, { ...normalQuery, planId: recovered.planId, confirm: true }),
    ).rejects.toMatchObject({ code: "plan-changed" });
  });

  it("does not trust an old verified flag when the current capture or live content no longer proves this build", async () => {
    const c = await stopped();
    const journal = await c.journal.read();
    if (journal === null) throw new Error("no journal");
    await c.journal.write({
      ...journal,
      pending: journal.pending?.map((entry) => ({ ...entry, verified: true })) ?? [],
    });
    c.tables["sys_update_xml"] = [];
    expect((await computeUnitPlan(c.deps, RECOVERY)).plan.ready).toBe(false);
    expect((await c.journal.read())?.pending?.[0]?.digest).toBe(journal.pending?.[0]?.digest);
  });

  it("refuses an unbuildable recovery source without changing its receipt or the instance", async () => {
    const c = await stopped();
    const journal = await c.journal.read();
    const before = [...c.calls];
    const deps = {
      ...c.deps,
      authoring: {
        ...c.deps.authoring,
        toolchain: {
          ...c.deps.authoring.toolchain,
          build: async () => ({ ok: false as const, message: "SDK build failed" }),
        },
      },
    };
    const { plan } = await computeUnitPlan(deps, RECOVERY);
    expect(plan).toMatchObject({
      ready: false,
      problems: expect.arrayContaining([
        expect.objectContaining({ kind: "build", reason: "SDK build failed" }),
      ]),
    });
    await expect(
      pushUnits(deps, { ...RECOVERY, planId: plan.planId, confirm: true }),
    ).rejects.toMatchObject({ code: "plan-not-ready" });
    expect(c.calls).toEqual(before);
    expect(await c.journal.read()).toEqual(journal);
  });
});
