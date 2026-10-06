import type { Artifact } from "../../metadata/domain/artifact";
import { isDeniedClass } from "../../metadata/domain/field-rules";
import { recordBase } from "../../metadata/domain/record-layout";

export type Operation = "update" | "create";

// One record write the plan would make, with the values to write.
export interface PlannedWrite {
  readonly operation: Operation;
  readonly table: string;
  readonly sysId: string;
  readonly scope: string;
  // The record's YAML file, relative to instances/<name>/metadata.
  readonly path: string;
  readonly values: Readonly<Record<string, string>>;
  // The record's hash when last pulled; push stops if the instance's differs. Null for creates.
  readonly baseHash: string | null;
}

export interface PlanProblem {
  readonly path: string;
  readonly reason: string;
}

export type ChangeOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "write"; readonly write: PlannedWrite }
  | { readonly kind: "problem"; readonly problem: PlanProblem };

export interface ParsedRecord {
  readonly artifact: Artifact;
  readonly storedHash: string | null;
}

const NONE: ChangeOutcome = { kind: "none" };
const problem = (path: string, reason: string): ChangeOutcome => ({
  kind: "problem",
  problem: { path, reason },
});

function changedFields(base: Artifact, target: Artifact): Record<string, string> {
  const names = new Set([...Object.keys(base.fields), ...Object.keys(target.fields)]);
  const changed: Record<string, string> = {};
  for (const name of [...names].sort()) {
    const value = target.fields[name] ?? "";
    if (value !== (base.fields[name] ?? "")) {
      changed[name] = value;
    }
  }
  return changed;
}

function update(path: string, base: ParsedRecord, target: ParsedRecord): ChangeOutcome {
  const was = base.artifact.identity;
  const now = target.artifact.identity;
  if (was.sysId !== now.sysId || was.className !== now.className) {
    return problem(path, "the record's class or sys_id changed; edit fields, not identity");
  }
  const values = changedFields(base.artifact, target.artifact);
  const redacted = Object.keys(values).filter((name) => base.artifact.redacted.includes(name));
  if (redacted.length > 0) {
    return problem(
      path,
      `${redacted.join(", ")} is never mirrored (secret); set it on the instance`,
    );
  }
  if (Object.keys(values).length === 0) {
    return NONE;
  }
  return {
    kind: "write",
    write: {
      operation: "update",
      table: now.className,
      sysId: now.sysId,
      scope: now.scope,
      path,
      values,
      baseHash: base.storedHash,
    },
  };
}

// What one record's edit means for the instance (spec 004, section 2).
export function changeOf(
  path: string,
  base: ParsedRecord | null,
  target: ParsedRecord | null,
): ChangeOutcome {
  if (target === null) {
    return base === null
      ? NONE
      : problem(
          path,
          "deleting records is not supported: restore the file and set active to false",
        );
  }
  if (base !== null) {
    return update(path, base, target);
  }
  const { identity, fields } = target.artifact;
  if (isDeniedClass(identity.className)) {
    return problem(path, `${identity.className} records are never synced or pushed`);
  }
  // Pull names files after the record's display name; a different name would leave two files
  // for one record after the next pull, and plan it as new again.
  const expected = `${recordBase(target.artifact)}.yaml`;
  if (expected !== path) {
    return problem(path, `rename it to ${expected}, the name the next pull gives this record`);
  }
  return {
    kind: "write",
    write: {
      operation: "create",
      table: identity.className,
      sysId: identity.sysId,
      scope: identity.scope,
      path,
      values: fields,
      baseHash: null,
    },
  };
}
