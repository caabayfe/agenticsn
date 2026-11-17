import { expect, it } from "bun:test";
import {
  type BuiltUnit,
  computeUnitPlan,
  PlanChangedError,
  pushUnits,
  unitDigest,
  withEntries,
} from "@snagentic/core";
import { QUERY, SI_UNIT, unitSetup } from "./unit-fixture";

const ID = "e".repeat(32);
const NAME = `sys_ui_related_list_entry_${ID}`;
const ENTRY: BuiltUnit = {
  updateName: NAME,
  file: `${NAME}.xml`,
  head: {
    table: "sys_ui_related_list_entry",
    sysId: ID,
    action: "INSERT_OR_UPDATE",
    fields: { sys_id: ID, list_id: "a".repeat(32), related_list: "task_sla.task", position: "12" },
    referenceNames: {},
  },
  children: [],
};

function setup() {
  const s = unitSetup();
  s.builds.get(s.project.path)?.push(ENTRY);
  const ledger = s.authoring.ledgers.get(s.project.path) ?? new Map();
  s.authoring.ledgers.set(
    s.project.path,
    withEntries(
      ledger,
      "dev",
      new Map([
        [NAME, { build: unitDigest(ENTRY), instance: "0|2026-11-15 18:50:21", losses: [] }],
      ]),
    ),
  );
  s.tables["sys_ui_related_list_entry"] = [];
  return s;
}

it("recreates an unchanged owned entry the install observed missing, leaving other unchanged units alone", async () => {
  const s = setup();
  const { plan } = await computeUnitPlan({ ...s.deps, recheckUnits: [NAME] }, QUERY);
  expect(plan.problems).toEqual([]);
  expect(plan.units.map((u) => [u.updateName, u.operation])).toEqual([[NAME, "create"]]);
  expect(plan.units.some((u) => u.updateName === SI_UNIT)).toBe(false);
  expect(s.fake.queries.filter((q) => q.table === "sys_script_include")).toEqual([]);
  expect(
    s.fake.queries
      .filter((q) => q.table === "sys_ui_related_list_entry")
      .every((q) => q.query.includes(ID)),
  ).toBe(true);
});

it("delivers a recreated entry through normal SDK load, capture and ledger checks, then is quiet", async () => {
  const s = setup();
  const deps = { ...s.deps, recheckUnits: [NAME] };
  const { plan } = await computeUnitPlan(deps, QUERY);
  const pushed = await pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true });
  expect(pushed.notApplied + pushed.notCaptured).toBe(0);
  expect(pushed.units).toMatchObject([{ updateName: NAME, captured: true, applied: true }]);
  expect((await computeUnitPlan(deps, QUERY)).plan.units).toEqual([]);
});

it("rechecks the repair plan before writing and refuses a record that appeared meanwhile", async () => {
  const s = setup();
  const deps = { ...s.deps, recheckUnits: [NAME] };
  const { plan } = await computeUnitPlan(deps, QUERY);
  s.tables["sys_ui_related_list_entry"] = [
    {
      ...ENTRY.head.fields,
      position: "99",
      sys_mod_count: "1",
      sys_updated_on: "2026-11-16 20:00:00",
      sys_package: "global",
    },
  ];
  await expect(
    pushUnits(deps, { ...QUERY, planId: plan.planId, confirm: true }),
  ).rejects.toBeInstanceOf(PlanChangedError);
  expect(s.calls).toEqual([]);
});

it("keeps ordinary planning limited to changed builds", async () => {
  const s = setup();
  expect((await computeUnitPlan(s.deps, QUERY)).plan.units).toEqual([]);
});

it("refuses drift when an observed-missing entry reappears changed before planning", async () => {
  const s = setup();
  s.tables["sys_ui_related_list_entry"] = [
    {
      ...ENTRY.head.fields,
      position: "99",
      sys_mod_count: "1",
      sys_updated_on: "2026-11-16 20:00:00",
      sys_package: "global",
    },
  ];
  const { plan } = await computeUnitPlan({ ...s.deps, recheckUnits: [NAME] }, QUERY);
  expect(plan.ready).toBe(false);
  expect(plan.problems).toMatchObject([{ updateName: NAME, kind: "drift" }]);
});

it("never broadens receipt-only recovery with missing ensure entries", async () => {
  const s = setup();
  const { plan } = await computeUnitPlan(
    { ...s.deps, recheckUnits: [NAME] },
    { ...QUERY, recoverPending: true },
  );
  expect(plan.units).toEqual([]);
});
