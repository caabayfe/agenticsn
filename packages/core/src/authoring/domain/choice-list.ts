import type { BuiltUnit } from "./unit";

// The platform records a field's choices as one update, sys_choice_<table>_<field>, holding the
// whole list; committing it replaces the list. Record({ table: 'sys_choice' }) builds a lone
// choice under that name (pdi2, spec 009 L8 A2), which would remove the field's other choices
// wherever the update set is committed. A choice set unit carries every choice of the list.

// Why a unit would replace a field's choice list with a single choice, or null.
export function loneChoiceRefusal(unit: BuiltUnit): string | null {
  const { table, fields } = unit.head;
  if (table !== "sys_choice") return null;
  const name = fields["name"] ?? "";
  const element = fields["element"] ?? "";
  if (unit.updateName !== `sys_choice_${name}_${element}`) return null;
  return `a lone choice is recorded as the whole choice list of ${name}.${element}, which would remove its other choices where the update set is committed: adopt the choice set of ${name}.${element} (sys_choice_set) and add the choice to it`;
}
