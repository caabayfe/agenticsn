import {
  type Rule,
  ruleById,
  rulesForScript,
  type ScriptKind,
  scriptFieldsOf,
} from "../../advice/index";
import type { BuiltUnit } from "../../authoring/domain/unit";
import { BEHAVIOR_CLASSES } from "../../knowledge/index";
import { type AclState, aclHits } from "../domain/acl-checks";
import { serializedObjectHits } from "../domain/built-values";
import { evidenceOf, type Finding } from "../domain/findings";
import type { RecordVersion, ScriptChecker } from "../ports";
import { type ChangedUnit, rolesOf } from "./unit-versions";

// The checks validate runs on one record: its scripts against the rule pack, a new script
// record's description, and what a change does to an ACL.

// Scripts above this size are reported as not checked rather than parsed (v1's limit).
export const MAX_SCRIPT_BYTES = 512_000;

export interface Skipped {
  readonly path: string;
  readonly reason: string;
}

export const finding = (
  rule: Rule,
  at: Omit<Finding, keyof Rule | "ruleId" | "severity">,
): Finding => ({
  ruleId: rule.id,
  severity: rule.severity,
  title: rule.title,
  why: rule.why,
  remediation: rule.remediation,
  ...at,
});

// When a business rule runs, as the platform reads its stored value; empty for other classes.
function whenOf(version: RecordVersion): string {
  const behavior = version.className === "sys_script" ? BEHAVIOR_CLASSES["sys_script"] : undefined;
  return behavior === undefined ? "" : behavior.phase(version.fields);
}

export interface Checked {
  readonly findings: Finding[];
  readonly skipped: Skipped[];
}

function checkScript(
  checker: ScriptChecker,
  version: RecordVersion,
  privileges: readonly string[],
  [field, kind]: readonly [string, ScriptKind],
): Checked {
  const path = version.files[field] ?? field;
  const source = version.fields[field] ?? "";
  if (source.length > MAX_SCRIPT_BYTES) {
    return { findings: [], skipped: [{ path, reason: `over ${MAX_SCRIPT_BYTES} bytes` }] };
  }
  const rules = rulesForScript(version.className, kind);
  const result = checker.check(
    source,
    rules.map((rule) => rule.id),
    {
      className: version.className,
      kind,
      scoped: version.scope !== "global",
      when: whenOf(version),
      type: version.fields["type"] ?? "",
      name: version.fields["name"] ?? "",
      scope: version.scope,
      privileges,
    },
  );
  const evidence = evidenceOf(source, result.parsed ? result.hits : []);
  const unparsed = ruleById("SN-MNT-007");
  if (!result.parsed) {
    const at = { path, field, line: result.line, message: result.message };
    return {
      findings:
        unparsed === undefined
          ? []
          : [finding(unparsed, { ...at, evidence: evidence(result.line) })],
      skipped: [],
    };
  }
  const findings = result.hits.flatMap((hit) => {
    const rule = rules.find((candidate) => candidate.id === hit.ruleId);
    const at = { path, field, line: hit.line, message: hit.message, evidence: evidence(hit.line) };
    return rule === undefined ? [] : [finding(rule, at)];
  });
  return { findings, skipped: [] };
}

export function checkVersion(
  checker: ScriptChecker,
  version: RecordVersion,
  privileges: readonly string[],
): Checked {
  const scripts = Object.entries(scriptFieldsOf(version.className, version.fields)).filter(
    ([field]) => (version.fields[field] ?? "").trim() !== "",
  );
  const checked = scripts.map((script) => checkScript(checker, version, privileges, script));
  return {
    findings: checked.flatMap((c) => c.findings),
    skipped: checked.flatMap((c) => c.skipped),
  };
}

// A new script record should say what it is for (SN-MNT-006).
export function undescribed(path: string, version: RecordVersion): Finding[] {
  const rule = ruleById("SN-MNT-006");
  const applies = rule?.classes?.includes(version.className) === true;
  if (rule === undefined || !applies || (version.fields["description"] ?? "").trim() !== "") {
    return [];
  }
  return [
    finding(rule, {
      path,
      field: "description",
      line: null,
      message: "new script records should describe their purpose",
      evidence: "",
    }),
  ];
}

const ACL_CLASS = "sys_security_acl";

export const withRule = (ruleId: string, at: Omit<Finding, keyof Rule | "ruleId" | "severity">) => {
  const rule = ruleById(ruleId);
  return rule === undefined ? [] : [finding(rule, at)];
};

// The ACL a Now.del removes: its definition at the base, found by the keys the Now.del names.
function deletedAcl(unit: BuiltUnit, base: readonly BuiltUnit[]): BuiltUnit | undefined {
  const keys = Object.entries(unit.head.fields).filter(([field]) => !field.startsWith("sys_"));
  return base.find(
    (old) => old.head.table === ACL_CLASS && keys.every(([f, v]) => old.head.fields[f] === v),
  );
}

export function aclFindings(
  changed: ChangedUnit,
  path: string,
  builds: { readonly now: readonly BuiltUnit[]; readonly base: readonly BuiltUnit[] },
): Finding[] {
  const { unit } = changed;
  if (unit.head.table !== ACL_CLASS) return [];
  const removed = unit.head.action === "DELETE" ? deletedAcl(unit, builds.base) : undefined;
  const beforeFields = removed?.head.fields ?? changed.before?.fields;
  const before: AclState | null =
    beforeFields === undefined
      ? null
      : {
          fields: beforeFields,
          roles: rolesOf(builds.base, removed?.head.sysId ?? unit.head.sysId),
        };
  const now: AclState | null =
    unit.head.action === "DELETE"
      ? null
      : { fields: unit.head.fields, roles: rolesOf(builds.now, unit.head.sysId) };
  return aclHits(before, now).flatMap((hit) =>
    withRule(hit.ruleId, {
      path,
      field: hit.field,
      line: null,
      message: hit.message,
      evidence: "",
    }),
  );
}

// Values the build wrote that can't be what the source meant.
export function builtValueFindings(changed: ChangedUnit, path: string): Finding[] {
  return serializedObjectHits(changed.unit).flatMap((hit) =>
    withRule(hit.ruleId, {
      path,
      field: hit.field,
      line: null,
      message: hit.message,
      evidence: "",
    }),
  );
}
