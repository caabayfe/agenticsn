import type { BuiltUnit } from "../../authoring/domain/unit";

// The update that carries a unit when the platform records none of its own: a label
// (sys_documentation) is created with its field or table's dictionary entry, so loading the same
// label changes nothing and the dictionary entry's update recreates it wherever it is committed
// (pdi4, 2026-10-25). A table's own label belongs to its collection entry, element "null".
export function carrierOf(unit: BuiltUnit): string | null {
  if (unit.head.table !== "sys_documentation") return null;
  const { name, element } = unit.head.fields;
  if (name === undefined || name === "") return null;
  return `sys_dictionary_${name}_${element === undefined || element === "" ? "null" : element}`;
}
