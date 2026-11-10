import { describe, expect, it } from "bun:test";
import {
  type BuiltUnit,
  computeUnitPlan,
  type LedgerEntry,
  type UnitRecord,
  withEntries,
} from "@snagentic/core";
import { QUERY, unitSetup } from "./unit-fixture";

// SDK 4.14 builds a related list and its entries as one unit, which 4.13 built as one unit per
// record (ADR-0046 item 4). A workspace delivered with 4.13 holds the old names in its ledger.

const LIST = "cf9c6e17877300100e3dd61e36cb0b42";
const COMPOSITE = "sys_ui_related_problem_null";
const STAMP = "0|2021-07-05 13:17:08";

const listRecord: UnitRecord = {
  table: "sys_ui_related_list",
  sysId: LIST,
  action: "INSERT_OR_UPDATE",
  fields: { sys_id: LIST, name: "problem", view: "Default view", sys_domain: "global" },
  referenceNames: { view: "NULL" },
};

const entryRecord = (sysId: string, list: string, position: number): UnitRecord => ({
  table: "sys_ui_related_list_entry",
  sysId,
  action: "INSERT_OR_UPDATE",
  fields: { sys_id: sysId, list_id: LIST, related_list: list, position: String(position) },
  referenceNames: {},
});

const ENTRIES = [
  { sysId: `${"e".repeat(31)}1`, list: "task_sla.task" },
  { sysId: `${"e".repeat(31)}2`, list: "problem_task.problem" },
];

const composite = (lists = ENTRIES): BuiltUnit => ({
  updateName: COMPOSITE,
  file: `${COMPOSITE}.xml`,
  head: listRecord,
  children: lists.map((e, i) => entryRecord(e.sysId, e.list, i)),
});

const instanceEntry = (sysId: string, list: string, position: number, stamp = STAMP) => {
  const [count, updated] = stamp.split("|");
  return {
    sys_id: sysId,
    list_id: LIST,
    related_list: list,
    position: String(position),
    sys_mod_count: count ?? "0",
    sys_updated_on: updated ?? "",
    sys_package: "global",
  };
};

const entryName = (sysId: string) => `sys_ui_related_list_entry_${sysId}`;
const LIST_NAME = `sys_ui_related_list_${LIST}`;

// A workspace whose ledger holds the list and its entries under 4.13's names, and an instance
// holding them as delivered then.
function setup(options: { built: BuiltUnit[]; ledgerNames?: readonly string[] }) {
  const s = unitSetup({ ledger: null });
  s.builds.set(s.project.path, options.built);
  s.tables["sys_script_include"] = [];
  s.tables["sys_ui_related_list"] = [
    {
      sys_id: LIST,
      name: "problem",
      view: "Default view",
      "view.name": "",
      sys_domain: "global",
      sys_mod_count: "0",
      sys_updated_on: "2021-07-05 13:17:08",
      sys_package: "global",
    },
  ];
  s.tables["sys_ui_related_list_entry"] = ENTRIES.map((e, i) => instanceEntry(e.sysId, e.list, i));
  const entry: LedgerEntry = { build: "b".repeat(32), instance: STAMP, losses: [] };
  const names = options.ledgerNames ?? [LIST_NAME, ...ENTRIES.map((e) => entryName(e.sysId))];
  s.authoring.ledgers.set(
    s.project.path,
    withEntries(new Map(), "dev", new Map(names.map((name) => [name, entry]))),
  );
  return s;
}

describe("a related list the SDK now builds whole (ADR-0046)", () => {
  it("forgets the old names the build now carries, and records the list the instance holds as built", async () => {
    const { deps } = setup({ built: [composite()] });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
    const operations = Object.fromEntries(plan.units.map((u) => [u.updateName, u.operation]));
    expect(operations).toEqual({
      [LIST_NAME]: "forget",
      [entryName(ENTRIES[0]?.sysId ?? "")]: "forget",
      [entryName(ENTRIES[1]?.sysId ?? "")]: "forget",
      [COMPOSITE]: "record",
    });
  });

  it("loads a changed list whose every part the branch held, unchanged since", async () => {
    const added = [...ENTRIES, { sysId: `${"e".repeat(31)}3`, list: "task_ci.task" }];
    const { deps } = setup({ built: [composite(added)] });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.units.find((u) => u.updateName === COMPOSITE)?.operation).toBe("load");
  });

  it("refuses a changed list when someone saved one of its entries since", async () => {
    const added = [...ENTRIES, { sysId: `${"e".repeat(31)}3`, list: "task_ci.task" }];
    const { deps, tables } = setup({ built: [composite(added)] });
    const [first, second] = ENTRIES;
    tables["sys_ui_related_list_entry"] = [
      instanceEntry(first?.sysId ?? "", first?.list ?? "", 0),
      instanceEntry(second?.sysId ?? "", second?.list ?? "", 1, "1|2026-11-03 09:00:00"),
    ];
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toMatchObject([{ updateName: COMPOSITE }]);
  });

  // Service Operations Workspace's incident list: a shipped list a module restated with its one
  // entry. Loaded whole, it would remove the platform's entries.
  it("refuses a list holding entries the branch never held: the load would remove them", async () => {
    const { deps, tables } = setup({ built: [composite()] });
    tables["sys_ui_related_list_entry"] = [
      ...ENTRIES.map((e, i) => instanceEntry(e.sysId, e.list, i)),
      instanceEntry("f".repeat(32), "task_ci.task", 2),
    ];
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toMatchObject([{ updateName: COMPOSITE }]);
  });

  it("releases a related list that built entries still name: deleting it would orphan them", async () => {
    const [first] = ENTRIES;
    const standalone: BuiltUnit = {
      updateName: entryName(first?.sysId ?? ""),
      file: `${entryName(first?.sysId ?? "")}.xml`,
      head: entryRecord(first?.sysId ?? "", first?.list ?? "", 0),
      children: [],
    };
    const { deps } = setup({
      built: [standalone],
      ledgerNames: [LIST_NAME, entryName(first?.sysId ?? "")],
    });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.units.find((u) => u.updateName === LIST_NAME)?.operation).toBe("forget");
  });

  it("keeps refusing a removed related list nothing built names", async () => {
    const { deps } = setup({ built: [], ledgerNames: [LIST_NAME] });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toMatchObject([{ updateName: LIST_NAME, kind: "removed" }]);
  });
});
