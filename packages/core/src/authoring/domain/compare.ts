import { platformWritten } from "../../metadata/domain/field-rules";
import type { BuiltUnit, Fields, InstanceCopy, UnitRecord } from "./unit";
import { type ChildSpec, unitSpec } from "./unit-specs";
import {
  comparedValue,
  isNamedReference,
  keyedReference,
  namedField,
  sameAttributes,
  sameValue,
} from "./values";

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
  // sys_policy is authored (protectionPolicy) and compared: the SDK writes it only when the
  // source sets it (B1).
  // The platform's own size bucket for a table (its collection entry), never authored.
  "sizeclass",
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

// A reference held as its keys, compared key by key with the instance's dot-walked values.
function keyedDifferences(
  table: string,
  row: string,
  field: string,
  keys: ReadonlyMap<string, string>,
  instance: Fields,
): Difference[] {
  return [...keys].flatMap(([key, built]): Difference[] => {
    const actual = instance[`${field}.${key}`];
    return actual === undefined || sameValue(built, actual)
      ? []
      : [{ kind: "field", table, row, field: `${field}.${key}`, built, instance: actual }];
  });
}

// One field's difference, if any.
function fieldDifference(
  record: UnitRecord,
  field: string,
  instance: Fields,
  row: string,
): Difference[] {
  const keys = keyedReference(record.fields[field] ?? "");
  if (keys !== null) return keyedDifferences(record.table, row, field, keys, instance);
  const [built, instanceField] = comparedValue(record, field);
  // A field the instance does not answer is a column it does not have: the load cannot set
  // it (the SDK writes sys_choice.inactive_on_update, which pdi2 has no column for).
  const actual = instance[instanceField];
  if (actual === undefined) return [];
  // A reference compared by name that holds the instance's own sys_id is the same reference,
  // even when the name can't be read (a role hidden from this user); a placeholder never is.
  if (instanceField !== field && record.fields[field] === instance[field]) return [];
  const same =
    record.table === "sys_dictionary" && field === "attributes"
      ? sameAttributes(built, actual)
      : sameValue(built, actual);
  return same ? [] : [{ kind: "field", table: record.table, row, field, built, instance: actual }];
}

function fieldDifferences(
  record: UnitRecord,
  instance: Fields,
  row: string,
  skip: ReadonlySet<string>,
): Difference[] {
  return Object.keys(record.fields)
    .sort()
    .flatMap((field) =>
      // A field the platform rewrites on save (an ACL's description) never equals what was sent.
      IGNORED.has(field) || skip.has(field) || platformWritten(record.table, field)
        ? []
        : fieldDifference(record, field, instance, row),
    );
}

const position = (fields: Fields) => Number(fields["position"] ?? 0);

// An instance row's key; a named reference in the key is its name, as the build's rows hold it.
const rowKey = (spec: ChildSpec, fields: Fields) =>
  spec.key
    .map((field) =>
      isNamedReference(spec.table, field)
        ? (fields[namedField(spec.table, field)] ?? "")
        : (fields[field] ?? ""),
    )
    .join("|");

// A built row's key, compared as each key field is compared.
const builtKey = (spec: ChildSpec, row: UnitRecord) =>
  spec.key.map((field) => comparedValue(row, field)[0]).join("|");

function keysOf<T>(
  spec: ChildSpec,
  rows: readonly T[],
  fields: (row: T) => Fields,
  key: (row: T) => string,
): string[] {
  const sorted = spec.ordered
    ? [...rows].sort((a, b) => position(fields(a)) - position(fields(b)))
    : rows;
  const keys = sorted.map(key);
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
    built,
    (row) => row.fields,
    (row) => builtKey(spec, row),
  );
  // A partial child's rows the build doesn't carry are left as they are by a load.
  const carried = new Set(builtKeys);
  const instanceKeys = keysOf(
    spec,
    spec.partial === true ? instance.filter((row) => carried.has(rowKey(spec, row))) : instance,
    (row) => row,
    (row) => rowKey(spec, row),
  );
  const differences: Difference[] = sameList(builtKeys, instanceKeys)
    ? []
    : [{ kind: "rows", table: spec.table, built: builtKeys, instance: instanceKeys }];
  // Rows present on both sides are compared field by field; the link and order are the rows'
  // place in the unit, compared above.
  const skip = new Set([...Object.keys(spec.link), ...(spec.ordered ? ["position"] : [])]);
  const byKey = new Map(instance.map((row) => [rowKey(spec, row), row]));
  for (const row of built) {
    const key = builtKey(spec, row);
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
