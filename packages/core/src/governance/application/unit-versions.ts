import { scriptFieldsOf } from "../../advice/index";
import { unitDigest } from "../../authoring/domain/digest";
import type { BuiltUnit } from "../../authoring/domain/unit";
import { normalizeValue } from "../../authoring/domain/values";
import type { RecordVersion } from "../ports";

// What validate checks in a Fluent project (ADR-0031 item 6): each unit the change added or
// edited, as its head now and at the base, with each script pointed to the source file holding
// it (a Now.include file), so findings name the file a person edits.

export interface ChangedUnit {
  readonly unit: BuiltUnit;
  readonly now: RecordVersion;
  readonly before: RecordVersion | null;
}

// The source file a script was built from: the include file with the same text, or the unit
// itself when the script is written inline in a .now.ts file.
function scriptPaths(
  unit: BuiltUnit,
  project: string,
  scripts: ReadonlyMap<string, string>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const field of Object.keys(scriptFieldsOf(unit.head.table, unit.head.fields))) {
    const text = normalizeValue(unit.head.fields[field] ?? "");
    const found = [...scripts].find(([, content]) => normalizeValue(content) === text)?.[0];
    files[field] = `${project}/${found ?? unit.updateName}`;
  }
  return files;
}

export function versionOf(
  unit: BuiltUnit,
  project: { readonly path: string; readonly scope: string },
  scripts: ReadonlyMap<string, string>,
): RecordVersion {
  return {
    className: unit.head.table,
    scope: project.scope,
    fields: unit.head.fields,
    files: scriptPaths(unit, project.path, scripts),
  };
}

// The units the change added or edited since the base build (null: the project is new).
export function changedUnits(
  project: { readonly path: string; readonly scope: string },
  now: { readonly units: readonly BuiltUnit[]; readonly scripts: ReadonlyMap<string, string> },
  base: {
    readonly units: readonly BuiltUnit[];
    readonly scripts: ReadonlyMap<string, string>;
  } | null,
): ChangedUnit[] {
  const before = new Map((base?.units ?? []).map((unit) => [unit.updateName, unit]));
  return now.units.flatMap((unit) => {
    const old = before.get(unit.updateName);
    if (old !== undefined && unitDigest(old) === unitDigest(unit)) return [];
    const was = old === undefined || base === null ? null : versionOf(old, project, base.scripts);
    return [{ unit, now: versionOf(unit, project, now.scripts), before: was }];
  });
}

// How many of the build's ACL roles name this ACL: an ACL with none opens to everyone.
export function rolesOf(units: readonly BuiltUnit[], aclSysId: string): number {
  return units.filter(
    (unit) =>
      unit.head.table === "sys_security_acl_role" &&
      unit.head.action !== "DELETE" &&
      unit.head.fields["sys_security_acl"] === aclSysId,
  ).length;
}
