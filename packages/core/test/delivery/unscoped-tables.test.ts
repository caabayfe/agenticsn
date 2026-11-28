import { describe, expect, it } from "bun:test";
import {
  type BuiltUnit,
  computeUnitPlan,
  type Row,
  unitDigest,
  withEntries,
} from "@snagentic/core";
import { QUERY, SI_UNIT, scriptInclude, unitSetup, VERSION } from "./unit-fixture";

// pdi15, 2026-11-28 (spike on throwaway records): fluent/load creates a cmn_schedule_span, and
// refuses to update or delete one with "Found cmn_schedule_span_<id>.xml with invalid scope.",
// with or without sys_scope in the file. The table has no sys_scope column anywhere in its
// ancestry; cmn_schedule inherits one from sys_metadata and loads (ADR-0060).

const SCHEDULE = "1".repeat(32);
const SPAN = "2".repeat(32);
const SPAN_UNIT = `cmn_schedule_span_${SPAN}`;
const SCHEDULE_UNIT = `cmn_schedule_${SCHEDULE}`;
const stamp = { sys_mod_count: "1", sys_updated_on: "2026-10-16 06:30:48", sys_domain: "global" };

const unitOf = (table: string, sysId: string, fields: Record<string, string>): BuiltUnit => ({
  updateName: `${table}_${sysId}`,
  file: `${table}_${sysId}.xml`,
  head: {
    table,
    sysId,
    action: "INSERT_OR_UPDATE",
    fields: { sys_id: sysId, ...fields },
    referenceNames: {},
  },
  children: [],
});

const span = (start: string) =>
  unitOf("cmn_schedule_span", SPAN, { name: "Weekdays", start_date_time: start });
const schedule = (description: string) =>
  unitOf("cmn_schedule", SCHEDULE, { name: "Business hours", description });

// The instance's tables: cmn_schedule extends business_calendar, which extends sys_metadata (the
// table that declares sys_scope); cmn_schedule_span extends business_calendar_span, a root.
function dictionary(tables: Record<string, Row[]>) {
  tables["sys_db_object"] = [
    { sys_id: "o1", name: "sys_metadata", "super_class.name": "" },
    { sys_id: "o2", name: "business_calendar", "super_class.name": "sys_metadata" },
    { sys_id: "o3", name: "cmn_schedule", "super_class.name": "business_calendar" },
    { sys_id: "o4", name: "business_calendar_span", "super_class.name": "" },
    { sys_id: "o5", name: "cmn_schedule_span", "super_class.name": "business_calendar_span" },
  ];
  tables["sys_dictionary"] = [
    { sys_id: "d1", name: "sys_metadata", element: "sys_scope", internal_type: "reference" },
    { sys_id: "d2", name: "cmn_schedule_span", element: "name", internal_type: "string" },
  ];
}

// The instance holds the schedule and its span as source last left them, and the ledger agrees.
function adopted() {
  const fixture = unitSetup();
  const { tables, authoring, project } = fixture;
  dictionary(tables);
  tables["cmn_schedule"] = [{ ...schedule("8-17").head.fields, ...stamp }];
  tables["cmn_schedule_span"] = [{ ...span("20260105T080000").head.fields, ...stamp }];
  const entry = (unit: BuiltUnit) => ({ build: unitDigest(unit), instance: VERSION, losses: [] });
  const si = { build: unitDigest(scriptInclude("Helpers.")), instance: VERSION, losses: [] };
  const entries = new Map([
    [SI_UNIT, si],
    [SCHEDULE_UNIT, entry(schedule("8-17"))],
    [SPAN_UNIT, entry(span("20260105T080000"))],
  ]);
  authoring.ledgers.set(project.path, withEntries(new Map(), "dev", entries));
  const build = (...units: BuiltUnit[]) =>
    fixture.builds.set(project.path, [scriptInclude("Helpers."), ...units]);
  return { ...fixture, build };
}

const REASON =
  "cmn_schedule_span has no application scope: the platform refuses to update or delete its " +
  "records through a load; change them as data (an accelerator data entity), not as source";

describe("plan refuses to change a record whose table has no application scope (ADR-0060)", () => {
  it("refuses an update, naming the table and saying to change it as data", async () => {
    const { deps, project, build } = adopted();
    build(schedule("8-17"), span("20260105T090000"));
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([
      { project: project.path, updateName: SPAN_UNIT, kind: "unsafe", reason: REASON },
    ]);
    expect(plan.units.map((u) => u.updateName)).not.toContain(SPAN_UNIT);
    expect(plan.ready).toBe(false);
  });

  it("refuses a deletion", async () => {
    const { deps, build } = adopted();
    const deletion = span("20260105T080000");
    build(schedule("8-17"), { ...deletion, head: { ...deletion.head, action: "DELETE" } });
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems.map((p) => [p.updateName, p.reason])).toEqual([[SPAN_UNIT, REASON]]);
  });

  it("creates a record the instance does not hold: the platform accepts that", async () => {
    const { deps, tables, build } = adopted();
    tables["cmn_schedule_span"] = [];
    build(schedule("8-17"), span("20260105T090000"));
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.units.find((u) => u.updateName === SPAN_UNIT)?.operation).toBe("create");
  });

  it("loads a change to a table that inherits its scope", async () => {
    const { deps, build } = adopted();
    build(schedule("9-18"), span("20260105T080000"));
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.units.find((u) => u.updateName === SCHEDULE_UNIT)?.operation).toBe("load");
  });

  it("loads a table the instance does not describe: only a missing scope column refuses", async () => {
    const { deps, tables, build } = adopted();
    tables["sys_db_object"] = [];
    build(schedule("8-17"), span("20260105T090000"));
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units.find((u) => u.updateName === SPAN_UNIT)?.operation).toBe("load");
  });

  it("loads a table whose ancestry the instance does not fully name", async () => {
    const { deps, tables, build } = adopted();
    // A parent given by sys_id alone: the chain cannot be followed, so nothing proves it lacks a
    // scope column.
    tables["sys_db_object"] = [
      { sys_id: "o5", name: "cmn_schedule_span", super_class: "o4", "super_class.name": "" },
    ];
    build(schedule("8-17"), span("20260105T090000"));
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.units.find((u) => u.updateName === SPAN_UNIT)?.operation).toBe("load");
  });

  it("reads no tables for a plan that changes nothing", async () => {
    const { deps, fake, build } = adopted();
    build(schedule("8-17"), span("20260105T080000"));
    await computeUnitPlan(deps, QUERY);
    expect(fake.queries.some((q) => String(q.table) === "sys_db_object")).toBe(false);
  });
});
