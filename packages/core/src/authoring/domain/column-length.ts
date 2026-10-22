import type { BuiltUnit, InstanceCopy } from "./unit";

// The platform's DictionaryUpdateLoader refuses to update a column whose max_length is empty
// ("Length change not allowed. Invalid new length (-1)") while fluent/load answers success
// (pdi2, 2026-10-18). A column the SDK built without maxLength is created, but no change to it
// ever lands. Inserting is accepted.

// Column types the platform stores as a sys_id: 32 characters, as baseline references are.
const SYS_ID_TYPES: ReadonlySet<string> = new Set(["reference", "document_id", "GUID"]);

// The maxLength a change to this column needs: the instance's own, or the platform's usual one.
function neededLength(unit: BuiltUnit, copy: InstanceCopy): string {
  const held = copy.head["max_length"]?.trim() ?? "";
  if (held !== "") return held;
  return SYS_ID_TYPES.has(unit.head.fields["internal_type"] ?? "") ? "32" : "40";
}

// Why the platform would refuse this column's change, or null when it would take it.
export function emptyLengthRefusal(unit: BuiltUnit, copy: InstanceCopy): string | null {
  const { table, fields } = unit.head;
  if (table !== "sys_dictionary" || (fields["max_length"] ?? "").trim() !== "") return null;
  const element = fields["element"] ?? "";
  // A table's collection entry has no length of its own.
  if (element === "" || fields["internal_type"] === "collection") return null;
  return `the platform refuses to change a column with no max length ("Length change not allowed"): give ${fields["name"] ?? ""}.${element} maxLength: ${neededLength(unit, copy)} in source`;
}
