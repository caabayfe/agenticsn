import type { UnitRecord } from "./unit";

// How built values compare with the instance's.

// References compared by the referenced record's name: the build writes a placeholder sys_id
// and the name beside it (a named view, a table's parent).
export const NAMED_REFERENCES: ReadonlySet<string> = new Set(["view", "super_class"]);

export const normalizeValue = (value: string): string =>
  value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

// Whether a built value and an instance value mean the same. The build writes an unset boolean
// as an empty element, which the platform reads as false.
export function sameValue(built: string, instance: string): boolean {
  const a = normalizeValue(built);
  const b = normalizeValue(instance);
  return a === b || (a === "" && b === "false");
}

// The build's "NULL" names the empty name the instance holds.
const builtName = (record: UnitRecord, field: string) => {
  const name = record.referenceNames[field] ?? record.fields[field] ?? "";
  return name === "NULL" ? "" : name;
};

// The value a built field is compared on, and the instance field it is compared with.
export function comparedValue(record: UnitRecord, field: string): [string, string] {
  return NAMED_REFERENCES.has(field)
    ? [builtName(record, field), `${field}.name`]
    : [record.fields[field] ?? "", field];
}
