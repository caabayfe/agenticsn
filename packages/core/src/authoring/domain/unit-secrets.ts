import type { Catalog } from "../../metadata/domain/catalog";
import { isDeniedClass } from "../../metadata/domain/field-rules";
import { fieldsToRedact, type RedactionPolicy } from "../../metadata/domain/redaction";
import type { BuiltUnit, UnitRecord } from "./unit";

// What a built unit would put in source that a pull keeps out of the mirror (security finding
// S2): a class the mirror never holds, or a non-empty value of a field pull redacts. One entry
// per unit and field, "<update name>: <field>"; values are never named.
export function unitSecrets(
  units: readonly BuiltUnit[],
  catalog: Catalog,
  policy: RedactionPolicy,
): string[] {
  const findings: string[] = [];
  for (const unit of units) {
    for (const row of [unit.head, ...unit.children]) {
      findings.push(...rowSecrets(unit.updateName, row, catalog, policy));
    }
  }
  return [...new Set(findings)];
}

// Classes the mirror skips for reasons other than secrecy: a unit may carry them into source.
const NOT_SECRET: ReadonlySet<string> = new Set([
  "sys_translated_text",
  "sys_documentation",
  "sys_ui_message",
]);

function rowSecrets(
  updateName: string,
  row: UnitRecord,
  catalog: Catalog,
  policy: RedactionPolicy,
): string[] {
  if (isDeniedClass(row.table) && !NOT_SECRET.has(row.table)) {
    return [`${updateName}: ${row.table} is never kept`];
  }
  const redacted = fieldsToRedact(catalog, row.table, row.fields, policy);
  return Object.entries(row.fields)
    .filter(([field, value]) => value !== "" && redacted.has(field.toLowerCase()))
    .map(([field]) => `${updateName}: ${field}`);
}
