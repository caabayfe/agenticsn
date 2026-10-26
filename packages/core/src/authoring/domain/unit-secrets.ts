import type { Catalog } from "../../metadata/domain/catalog";
import { deniedAncestor } from "../../metadata/domain/field-rules";
import { fieldsToRedact, type RedactionPolicy } from "../../metadata/domain/redaction";
import { scanSecrets } from "../../metadata/domain/secret-scan";
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
  const denied = deniedAncestor(catalog, row.table);
  if (denied !== undefined && !NOT_SECRET.has(denied)) {
    return [`${updateName}: ${row.table} is never kept`];
  }
  const redacted = fieldsToRedact(catalog, row.table, row.fields, policy);
  const protectedFields = Object.entries(row.fields)
    .filter(([field, value]) => value !== "" && redacted.has(field.toLowerCase()))
    .map(([field]) => `${updateName}: ${field}`);
  const detected = Object.entries(row.fields).flatMap(([field, value]) =>
    redacted.has(field.toLowerCase())
      ? []
      : scanSecrets(value).patterns.map((pattern) => `${updateName}: ${field} contains ${pattern}`),
  );
  return [...protectedFields, ...detected];
}

// Checks the exact source files the SDK would write, including content not represented by
// its rebuilt units. Paths are scanned too so an error never echoes a credential-shaped name.
export function draftFileSecrets(files: ReadonlyMap<string, string>): string[] {
  return [...files]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([path, content]) => {
      const safePath = scanSecrets(path);
      const patterns = new Set([...safePath.patterns, ...scanSecrets(content).patterns]);
      return [...patterns].map((pattern) => `${safePath.text}: ${pattern}`);
    });
}
