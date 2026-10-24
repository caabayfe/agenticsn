import type { PlannedField } from "../domain/install-plan";
import { fieldIssues } from "../domain/required-fields";
import type { SchemaReader } from "../ports";

// The fields that waited for an activation, read again from the mirror after the install pulled
// (spec 011, section 15, item 3). Fields the plan found missing for any other reason are read
// too: on a resumed run the plan is built after the activation, so nothing waits any more.
export async function recheckFields(
  planned: readonly PlannedField[],
  schema: SchemaReader,
): Promise<{ readonly checked: number; readonly problems: string[]; readonly warnings: string[] }> {
  schema.refresh();
  const waiting = planned.filter((f) => f.state !== "present");
  const checks: PlannedField[] = [];
  for (const field of waiting) {
    const fields = await schema.fieldsOf(field.table);
    const state =
      fields === null ? "no-table" : fields.includes(field.field) ? "present" : "missing";
    checks.push({ ...field, state });
  }
  return { checked: waiting.length, ...fieldIssues(checks) };
}
