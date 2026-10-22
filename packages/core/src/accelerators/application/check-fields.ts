import type { Capability } from "../domain/manifest-types";
import { type FieldCheck, requiredFields } from "../domain/required-fields";
import type { SchemaReader } from "../ports";

// Checks the platform fields the selected modules read against the mirror (plan gap G13), each
// table read once.
export async function checkFields(
  modules: readonly Capability[],
  schema: SchemaReader,
): Promise<FieldCheck[]> {
  const tables = new Map<string, ReadonlySet<string> | null>();
  const fieldsOf = async (table: string) => {
    if (!tables.has(table)) {
      const fields = await schema.fieldsOf(table);
      tables.set(table, fields === null ? null : new Set(fields));
    }
    return tables.get(table) ?? null;
  };
  const checks: FieldCheck[] = [];
  for (const module of modules) {
    for (const required of requiredFields(module)) {
      const fields = await fieldsOf(required.table);
      const state =
        fields === null ? "no-table" : fields.has(required.field) ? "present" : "missing";
      checks.push({ ...required, module: module.id, state });
    }
  }
  return checks;
}
