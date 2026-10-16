import type { BuiltUnit, Fields, InstanceCopy, UnitRecord } from "./unit";
import { type ChildSpec, unitSpec } from "./unit-specs";
import { comparedValue, sameValue } from "./values";

// One comparison of a built unit with the instance's copy (ADR-0033 item 2).

// Platform bookkeeping: never authored, so never compared.
const IGNORED: ReadonlySet<string> = new Set([
  "sys_id",
  "sys_scope",
  "sys_package",
  "sys_update_name",
  "sys_class_name",
  "sys_created_by",
  "sys_created_on",
  "sys_updated_by",
  "sys_updated_on",
  "sys_mod_count",
  "sys_domain_path",
  "sys_name",
  "sys_tags",
  "sys_policy",
]);

export type Difference =
  | {
      readonly kind: "field";
      readonly table: string;
      // "" for the head; a row's key within the unit otherwise.
      readonly row: string;
      readonly field: string;
      readonly built: string;
      readonly instance: string;
    }
  | {
      // Rows added, removed or reordered: each side as its row keys, in order when ordered.
      readonly kind: "rows";
      readonly table: string;
      readonly built: readonly string[];
      readonly instance: readonly string[];
    };

function fieldDifferences(
  record: UnitRecord,
  instance: Fields,
  row: string,
  skip: ReadonlySet<string>,
): Difference[] {
  const differences: Difference[] = [];
  for (const field of Object.keys(record.fields).sort()) {
    if (IGNORED.has(field) || skip.has(field)) continue;
    const [built, instanceField] = comparedValue(record, field);
    const actual = instance[instanceField] ?? "";
    if (!sameValue(built, actual)) {
      differences.push({ kind: "field", table: record.table, row, field, built, instance: actual });
    }
  }
  return differences;
}

const position = (fields: Fields) => Number(fields["position"] ?? 0);

const rowKey = (spec: ChildSpec, fields: Fields) =>
  spec.key.map((field) => fields[field] ?? "").join("|");

function keysOf(spec: ChildSpec, rows: readonly Fields[]): string[] {
  const sorted = spec.ordered ? [...rows].sort((a, b) => position(a) - position(b)) : rows;
  const keys = sorted.map((row) => rowKey(spec, row));
  return spec.ordered ? keys : keys.sort();
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function childDifferences(
  spec: ChildSpec,
  built: readonly UnitRecord[],
  instance: readonly Fields[],
): Difference[] {
  const builtKeys = keysOf(
    spec,
    built.map((row) => row.fields),
  );
  const instanceKeys = keysOf(spec, instance);
  const differences: Difference[] = sameList(builtKeys, instanceKeys)
    ? []
    : [{ kind: "rows", table: spec.table, built: builtKeys, instance: instanceKeys }];
  // Rows present on both sides are compared field by field; the link and order are the rows'
  // place in the unit, compared above.
  const skip = new Set([...Object.keys(spec.link), ...(spec.ordered ? ["position"] : [])]);
  const byKey = new Map(instance.map((row) => [rowKey(spec, row), row]));
  for (const row of built) {
    const key = rowKey(spec, row.fields);
    const match = byKey.get(key);
    if (match !== undefined) differences.push(...fieldDifferences(row, match, key, skip));
  }
  return differences;
}

// The differences between what the build would load and what the instance holds. Empty when
// loading the unit would change nothing the build manages.
export function compareUnit(unit: BuiltUnit, copy: InstanceCopy): readonly Difference[] {
  const spec = unitSpec(unit.head.table);
  const differences = fieldDifferences(unit.head, copy.head, "", new Set());
  if (spec.children !== undefined) {
    differences.push(...childDifferences(spec.children, unit.children, copy.children));
  }
  return differences;
}
