import type { BuiltUnit } from "../../authoring/domain/unit";
import type { InstanceReader } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import {
  CUT_TYPES,
  type CutValue,
  cutReason,
  cutValues,
  type FieldLengths,
  inheritedLengths,
} from "../domain/field-lengths";
import type { PlannedUnit, UnitProblem } from "../domain/unit-plan";

// Reads, for the tables a plan would load, the lengths their text fields keep: the tables'
// ancestry one level per request, then their dictionary entries. A plan that loads nothing
// reads nothing (ADR-0016).

async function list(
  pager: KeysetPager,
  table: string,
  base: string,
  fields: readonly string[],
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  const listing = { kind: "snapshot" as const, table: TableName.parse(table), base, fields };
  for await (const row of pager.rows(listing, signal)) rows.push(row);
  return rows;
}

async function ancestry(pager: KeysetPager, tables: readonly string[], signal: AbortSignal) {
  const parents = new Map<string, string>();
  let level = [...tables];
  while (level.length > 0) {
    const rows = await list(
      pager,
      "sys_db_object",
      `nameIN${level.join(",")}`,
      ["sys_id", "name", "super_class.name"],
      signal,
    );
    level = [];
    for (const row of rows) {
      const parent = row["super_class.name"] ?? "";
      if (parent === "" || parents.has(row["name"] ?? "")) continue;
      parents.set(row["name"] ?? "", parent);
      if (!parents.has(parent) && !tables.includes(parent)) level.push(parent);
    }
  }
  return parents;
}

async function lengthsOf(
  reader: InstanceReader,
  tables: readonly string[],
  signal: AbortSignal,
): Promise<FieldLengths> {
  const pager = new KeysetPager(reader);
  const parents = await ancestry(pager, tables, signal);
  const all = [...new Set([...tables, ...parents.values()])];
  const rows = await list(
    pager,
    "sys_dictionary",
    `nameIN${all.join(",")}^internal_typeIN${CUT_TYPES.join(",")}`,
    ["sys_id", "name", "element", "max_length"],
    signal,
  );
  const declared = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const table = row["name"] ?? "";
    const fields = declared.get(table) ?? new Map<string, number>();
    fields.set(row["element"] ?? "", Number(row["max_length"] ?? 0) || 0);
    declared.set(table, fields);
  }
  return inheritedLengths(tables, parents, declared);
}

// The values of these units the instance would cut, by unit.
async function cutValuesOf(
  reader: InstanceReader,
  units: readonly BuiltUnit[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, readonly CutValue[]>> {
  if (units.length === 0) return new Map();
  const tables = [
    ...new Set(units.flatMap((u) => [u.head.table, ...u.children.map((c) => c.table)])),
  ];
  const lengths = await lengthsOf(reader, tables, signal);
  const cut = new Map<string, readonly CutValue[]>();
  for (const unit of units) {
    const values = cutValues(unit, lengths);
    if (values.length > 0) cut.set(unit.updateName, values);
  }
  return cut;
}

interface PlannedLoad {
  readonly units: readonly PlannedUnit[];
  readonly built: ReadonlyMap<string, { readonly unit: BuiltUnit }>;
}

// Takes out of each project's load the units holding a value the instance would cut, each one
// a problem naming the field.
export async function withoutCutValues<L extends PlannedLoad>(
  reader: InstanceReader,
  loads: readonly L[],
  signal: AbortSignal,
): Promise<{ readonly loads: L[]; readonly problems: UnitProblem[] }> {
  const written = loads.flatMap((load) =>
    load.units
      .filter((unit) => unit.operation === "create" || unit.operation === "load")
      .flatMap((unit) => load.built.get(unit.updateName)?.unit ?? []),
  );
  const cut = await cutValuesOf(reader, written, signal);
  const problems = loads.flatMap((load) =>
    load.units.flatMap((unit) =>
      (cut.get(unit.updateName) ?? []).map((value) => ({
        project: unit.project,
        updateName: unit.updateName,
        kind: "unsafe" as const,
        reason: cutReason(value),
      })),
    ),
  );
  const kept = loads.map((load) => ({
    ...load,
    units: load.units.filter((unit) => !cut.has(unit.updateName)),
  }));
  return { loads: kept, problems };
}
