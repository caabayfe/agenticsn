import type { UnitRecord } from "./unit";

// How built values compare with the instance's.

// References compared by the referenced record's name: the build writes a placeholder sys_id
// and the name beside it. A named view and a table's parent, on any table.
export const NAMED_REFERENCES: ReadonlySet<string> = new Set(["view", "super_class"]);

// Roles and views a typed API takes by name, on the child rows that hold them (spec 009 B3).
// Per table: a field called role elsewhere is no reference.
const NAMED_BY_TABLE: Readonly<Record<string, ReadonlySet<string>>> = {
  sys_ui_action_role: new Set(["sys_user_role"]),
  sys_security_acl_role: new Set(["sys_user_role"]),
  sys_ui_action_view: new Set(["sys_ui_view"]),
  sys_user_role_contains: new Set(["role", "contains"]),
};

export function isNamedReference(table: string, field: string): boolean {
  return NAMED_REFERENCES.has(field) || (NAMED_BY_TABLE[table]?.has(field) ?? false);
}

export const normalizeValue = (value: string): string =>
  value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");

// Whether a built value and an instance value mean the same. The build writes an unset boolean
// as an empty element, which the platform reads as false.
export function sameValue(built: string, instance: string): boolean {
  const a = normalizeValue(built);
  const b = normalizeValue(instance);
  return a === b || (a === "" && b === "false");
}

// Dictionary attributes the platform adds on its own when a table is created (spike S-D): the
// load never sent them, so an instance value that adds only these agrees with the build.
const PLATFORM_ATTRIBUTES: ReadonlySet<string> = new Set([
  "enforce_dot_walk_cross_scope_access=true",
]);

const attributeList = (value: string) =>
  normalizeValue(value)
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

// Whether a built dictionary `attributes` value and the instance's mean the same.
export function sameAttributes(built: string, instance: string): boolean {
  const wanted = attributeList(built);
  const held = attributeList(instance).filter(
    (a) => wanted.includes(a) || !PLATFORM_ATTRIBUTES.has(a),
  );
  return wanted.length === held.length && wanted.every((a) => held.includes(a));
}

// The build's "NULL" names the empty name the instance holds.
const builtName = (record: UnitRecord, field: string) => {
  const name = record.referenceNames[field] ?? record.fields[field] ?? "";
  return name === "NULL" ? "" : name;
};

// The value a built field is compared on, and the instance field it is compared with. A named
// reference the build wrote with no name (keys.ts knew the sys_id) is compared by sys_id.
export function comparedValue(record: UnitRecord, field: string): [string, string] {
  const named = NAMED_REFERENCES.has(field) || record.referenceNames[field] !== undefined;
  return isNamedReference(record.table, field) && named
    ? [builtName(record, field), `${field}.name`]
    : [record.fields[field] ?? "", field];
}
