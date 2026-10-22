import type { Capability, RequiredField } from "./manifest-types";

// The platform fields a module reads, and what the install plan says when the instance lacks one
// (plan gap G13, spec 011 I14). Pure: the mirror's schema is read by the application.

export type FieldState = "present" | "missing" | "no-table";

export interface FieldCheck extends RequiredField {
  readonly module: string;
  readonly state: FieldState;
}

// The pack's own tables and fields (u_, x_) are created by its modules: not the platform's.
const ownName = (name: string) => name.startsWith("u_") || name.startsWith("x_");

// The fields a module declares, then the target fields its data columns fill: a load into a field
// the instance lacks would lose the column.
export function requiredFields(module: Capability): RequiredField[] {
  const fromData = module.data.flatMap((entity) =>
    entity.target === null || ownName(entity.target)
      ? []
      : entity.columns
          .filter((c) => c.field !== null && !ownName(c.field))
          .map(
            (c): RequiredField => ({
              table: entity.target ?? "",
              field: c.field ?? "",
              from: null,
              whenMissing: "stop",
              note: null,
            }),
          ),
  );
  const seen = new Set<string>();
  return [...module.fields, ...fromData].filter((f) => {
    const key = `${f.table}.${f.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sentence(check: FieldCheck): string {
  const where = check.state === "no-table" ? `its table ${check.table}` : "it";
  const lost = check.whenMissing === "warn" && check.note !== null ? `: ${check.note}` : "";
  const fix =
    check.from === null
      ? ` Find the plugin that ships ${where}, repair or activate it on the instance, then pull`
      : ` It ships with ${check.from}: repair or activate it on the instance, then pull`;
  return `field ${check.table}.${check.field} (${check.module}) is not on the instance${lost}.${fix}`;
}

// Missing fields a module needs stop the install; those it can do without are warnings.
export function fieldIssues(checks: readonly FieldCheck[]): {
  problems: string[];
  warnings: string[];
} {
  const missing = checks.filter((c) => c.state !== "present");
  return {
    problems: missing.filter((c) => c.whenMissing === "stop").map(sentence),
    warnings: missing.filter((c) => c.whenMissing === "warn").map(sentence),
  };
}
