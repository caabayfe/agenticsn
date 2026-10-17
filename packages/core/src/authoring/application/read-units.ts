import type { InstanceReader } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import type { BuiltUnit, Fields, InstanceCopy } from "../domain/unit";
import { type ChildSpec, childLink, coalesceValues, unitSpec } from "../domain/unit-specs";
import { VERSION_FIELDS, versionOf } from "../domain/unit-version";
import { NAMED_REFERENCES } from "../domain/values";

// Reads the instance's copy of each unit (ADR-0033 item 1): heads by sys_id, then by the keys
// the platform coalesces on, then the composites' rows. Every request is a keyset listing on
// indexed fields, batched per table (ADR-0016).

const BATCH = 100;

const chunks = <T>(items: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(items.length / BATCH) }, (_, i) =>
    items.slice(i * BATCH, (i + 1) * BATCH),
  );

// The fields to ask for: what the build wrote (named references by name too), the version
// fields, the domain, and what identifies the row.
function fieldsFor(records: readonly Fields[], extra: readonly string[]): string[] {
  // sys_update_name ties a Now.del found by its keys to the ledger entry it removes.
  const fields = new Set<string>([...VERSION_FIELDS, "sys_domain", "sys_update_name", ...extra]);
  for (const record of records) {
    for (const field of Object.keys(record)) {
      fields.add(field);
      if (NAMED_REFERENCES.has(field)) fields.add(`${field}.name`);
    }
  }
  return [...fields].sort();
}

async function list(
  pager: KeysetPager,
  table: string,
  base: string,
  fields: readonly string[],
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  // Every domain: a unit's rows may live in another domain than its head (S17 on pdi2).
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse(table),
    base,
    fields,
    allDomains: true,
  };
  for await (const row of pager.rows(listing, signal)) rows.push(row);
  return rows;
}

const condition = (field: string, value: string) =>
  value === "" ? `${field}ISEMPTY` : `${field}=${value}`;

// Heads found by sys_id, by table.
async function headsById(pager: KeysetPager, units: readonly BuiltUnit[], signal: AbortSignal) {
  const found = new Map<string, Row>();
  const byTable = Map.groupBy(units, (unit) => unit.head.table);
  // Listings run together; the instance's request scheduler sets the pace (ADR-0016).
  const listings = [...byTable].flatMap(([table, group]) => {
    const fields = fieldsFor(
      group.map((u) => u.head.fields),
      unitSpec(table).coalesce ?? [],
    );
    return chunks(group.map((u) => u.head.sysId).filter(Boolean)).map((chunk) =>
      list(pager, table, `sys_idIN${chunk.join(",")}`, fields, signal).then((rows) => {
        for (const row of rows) found.set(`${table}:${row["sys_id"]}`, row);
      }),
    );
  });
  await Promise.all(listings);
  return units.map((unit) => found.get(`${unit.head.table}:${unit.head.sysId}`) ?? null);
}

interface KeyedUnit {
  readonly unit: BuiltUnit;
  readonly values: Fields;
}

const sameKeys = (row: Row, values: Fields) =>
  Object.entries(values).every(([field, value]) => (row[field] ?? "") === value);

// One listing for units that share every key but the last: the last is matched with IN, which
// works for values that hold no comma and are not empty.
function keyGroups(units: readonly KeyedUnit[]): Map<string, KeyedUnit[]> {
  return Map.groupBy(units, ({ unit, values }) => {
    const entries = Object.entries(values);
    const last = entries.at(-1)?.[1] ?? "";
    const shared = entries.slice(0, -1).map(([f, v]) => condition(f, v));
    const own = last === "" || last.includes(",") ? unit.updateName : "";
    return [unit.head.table, own, ...shared].join("^");
  });
}

// One key group's listing: each unit's head, when exactly one row has its keys.
async function readGroup(
  pager: KeysetPager,
  group: readonly KeyedUnit[],
  signal: AbortSignal,
): Promise<[string, Row][]> {
  const first = group[0];
  if (first === undefined) return [];
  const entries = Object.entries(first.values);
  const [lastField = "", lastValue = ""] = entries.at(-1) ?? [];
  const lasts = group.map(({ values }) => values[lastField] ?? "");
  const last =
    group.length === 1 ? condition(lastField, lastValue) : `${lastField}IN${lasts.join(",")}`;
  const base = [...entries.slice(0, -1).map(([f, v]) => condition(f, v)), last].join("^");
  const fields = fieldsFor(
    group.map(({ unit }) => unit.head.fields),
    Object.keys(first.values),
  );
  const rows = await list(pager, first.unit.head.table, base, fields, signal);
  return group.flatMap(({ unit, values }): [string, Row][] => {
    const matches = rows.filter((row) => sameKeys(row, values));
    return matches.length === 1 && matches[0] !== undefined ? [[unit.updateName, matches[0]]] : [];
  });
}

// Heads the platform matches by content (dictionary entries, labels, layouts), by update name.
async function headsByKeys(pager: KeysetPager, units: readonly BuiltUnit[], signal: AbortSignal) {
  const keyed = units.flatMap((unit) => {
    const values = coalesceValues(unit);
    return values === null ? [] : [{ unit, values }];
  });
  const groups = [...keyGroups(keyed).values()];
  const found = await Promise.all(groups.map((group) => readGroup(pager, group, signal)));
  return new Map(found.flat());
}

async function rowsOf(
  pager: KeysetPager,
  spec: ChildSpec,
  unit: BuiltUnit,
  head: Row,
  signal: AbortSignal,
) {
  const base = Object.entries(childLink(spec, head))
    .map(([field, value]) => condition(field, value))
    .join("^");
  const fields = fieldsFor(
    unit.children.map((c) => c.fields),
    [...spec.key, ...Object.keys(spec.link), ...(spec.ordered ? ["position"] : [])],
  );
  return list(pager, spec.table, base, fields, signal);
}

async function copyOf(
  pager: KeysetPager,
  unit: BuiltUnit,
  head: Row,
  signal: AbortSignal,
): Promise<InstanceCopy> {
  const spec = unitSpec(unit.head.table).children;
  const rows = spec === undefined ? [] : await rowsOf(pager, spec, unit, head, signal);
  const domain = head["sys_domain"] ?? "global";
  const own = rows.filter((row) => (row["sys_domain"] ?? domain) === domain);
  return {
    head,
    children: own,
    version: versionOf(head, rows),
    foreignRows: rows.length - own.length,
  };
}

// The instance's copy of each unit, by update name; null when the instance holds none.
export async function readUnits(
  reader: InstanceReader,
  units: readonly BuiltUnit[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, InstanceCopy | null>> {
  const pager = new KeysetPager(reader);
  const byId = await headsById(pager, units, signal);
  const missing = units.filter((_, index) => byId[index] === null);
  const byKeys = await headsByKeys(pager, missing, signal);
  const read = units.map(async (unit, index): Promise<[string, InstanceCopy | null]> => {
    const head = byId[index] ?? byKeys.get(unit.updateName) ?? null;
    return [unit.updateName, head === null ? null : await copyOf(pager, unit, head, signal)];
  });
  return new Map(await Promise.all(read));
}
