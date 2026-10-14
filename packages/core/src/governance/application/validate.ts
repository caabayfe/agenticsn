import {
  type Rule,
  ruleById,
  rulesForScript,
  type ScriptKind,
  scriptFieldsOf,
} from "../../advice/index";
import { BEHAVIOR_CLASSES, baseOfFile } from "../../knowledge/index";
import { type AclState, aclHits, opensWithoutRoles } from "../domain/acl-checks";
import { UnknownBaseError } from "../domain/errors";
import {
  evidenceOf,
  type Finding,
  type FindingSeverity,
  introduced,
  ordered,
} from "../domain/findings";
import type { ChangedRecords, RecordVersion, ScriptChecker } from "../ports";

// Scripts above this size are reported as not checked rather than parsed (v1's limit).
export const MAX_SCRIPT_BYTES = 512_000;

export interface ValidateQuery {
  // What the change is compared against: a commit, branch or tag. Only findings the change
  // introduced since then are reported.
  readonly base: string;
  // Files to check; every record changed since `base` when absent.
  readonly paths?: readonly string[];
}

export interface Skipped {
  readonly path: string;
  readonly reason: string;
}

export interface Validation {
  readonly base: string;
  readonly records: number;
  readonly passed: boolean;
  readonly counts: Readonly<Record<FindingSeverity, number>>;
  readonly findings: readonly Finding[];
  readonly notChecked: readonly Skipped[];
  readonly rulesNotChecked: readonly { readonly ruleId: string; readonly reason: string }[];
}

export interface ValidateDependencies {
  readonly records: ChangedRecords;
  readonly checker: ScriptChecker;
}

// Rules no check covers yet, said rather than silently passed.
const RULES_NOT_CHECKED = [
  { ruleId: "SN-UPG-002", reason: "needs the inventory of customized out-of-box records" },
];

const finding = (rule: Rule, at: Omit<Finding, keyof Rule | "ruleId" | "severity">): Finding => ({
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

interface Checked {
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

function checkVersion(
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
function undescribed(base: string, version: RecordVersion): Finding[] {
  const rule = ruleById("SN-MNT-006");
  const applies = rule?.classes?.includes(version.className) === true;
  if (rule === undefined || !applies || (version.fields["description"] ?? "").trim() !== "") {
    return [];
  }
  return [
    finding(rule, {
      path: `${base}.yaml`,
      field: "description",
      line: null,
      message: "new script records should describe their purpose",
      evidence: "",
    }),
  ];
}

const ACL_CLASS = "sys_security_acl";

// An ACL's roles are counted only when nothing else restricts it: a lookup over every role.
async function aclState(
  records: ChangedRecords,
  version: RecordVersion | null,
  base: string,
  commit: string | null,
): Promise<AclState | null> {
  if (version?.className !== ACL_CLASS) {
    return null;
  }
  const sysId = base.slice(base.lastIndexOf("--") + 2);
  const roles = opensWithoutRoles(version.fields)
    ? await records.countReferences("sys_security_acl_role", ACL_CLASS, sysId, commit)
    : null;
  return { fields: version.fields, roles };
}

async function aclFindings(
  deps: ValidateDependencies,
  commit: string,
  base: string,
  versions: { readonly before: RecordVersion | null; readonly now: RecordVersion | null },
): Promise<Finding[]> {
  if (versions.before?.className !== ACL_CLASS && versions.now?.className !== ACL_CLASS) {
    return [];
  }
  const hits = aclHits(
    await aclState(deps.records, versions.before, base, commit),
    await aclState(deps.records, versions.now, base, null),
  );
  return hits.flatMap((hit) => {
    const rule = ruleById(hit.ruleId);
    const at = { path: `${base}.yaml`, field: hit.field, line: null, message: hit.message };
    return rule === undefined ? [] : [finding(rule, { ...at, evidence: "" })];
  });
}

// Each application's declared privileges, read once per validation.
type Privileges = (scope: string) => Promise<readonly string[]>;

function privilegesOnce(records: ChangedRecords): Privileges {
  const read = new Map<string, Promise<readonly string[]>>();
  return (scope) => {
    if (scope === "global") {
      return Promise.resolve([]);
    }
    const known = read.get(scope) ?? records.privileges(scope);
    read.set(scope, known);
    return known;
  };
}

async function checkRecord(
  deps: ValidateDependencies,
  privilegesOf: Privileges,
  commit: string,
  base: string,
) {
  const now = await deps.records.current(base);
  const before = await deps.records.at(commit, base);
  const acl = await aclFindings(deps, commit, base, { before, now });
  if (now === null) {
    return acl.length === 0 ? null : { findings: acl, skipped: [] };
  }
  const privileges = await privilegesOf(now.scope);
  const current = checkVersion(deps.checker, now, privileges);
  const previous = before === null ? [] : checkVersion(deps.checker, before, privileges).findings;
  return {
    findings: [
      ...introduced(current.findings, previous),
      ...(before === null ? undescribed(base, now) : []),
      ...acl,
    ],
    skipped: current.skipped,
  };
}

// What to check, and against which commit. While integrate merges the instance (the
// pre-commit hook runs on its merge commit), what the instance already holds is not this
// change's doing: only records that also differ from the instance's version are checked,
// against that version. A named base or explicit paths are taken as asked.
async function scope(
  records: ChangedRecords,
  query: ValidateQuery,
  resolved: string,
): Promise<{ commit: string; bases: readonly string[] }> {
  if (query.paths !== undefined) {
    return { commit: resolved, bases: [...new Set(query.paths.map(baseOfFile))].sort() };
  }
  const mirror = query.base === "HEAD" ? await records.mirrorMerge() : null;
  if (mirror === null) {
    return { commit: resolved, bases: await records.changedSince(resolved) };
  }
  const local = new Set(await records.changedSince(mirror));
  const bases = (await records.changedSince(resolved)).filter((base) => local.has(base));
  return { commit: mirror, bases };
}

// Checks the changed records against the rules, reporting only what the change introduced.
export async function validate(
  deps: ValidateDependencies,
  query: ValidateQuery,
): Promise<Validation> {
  const resolved = await deps.records.resolve(query.base);
  if (resolved === null) {
    throw new UnknownBaseError(query.base);
  }
  const { commit, bases } = await scope(deps.records, query, resolved);
  const results = [];
  const privilegesOf = privilegesOnce(deps.records);
  for (const base of bases) {
    results.push(await checkRecord(deps, privilegesOf, commit, base));
  }
  const checked = results.filter((result) => result !== null);
  const findings = ordered(checked.flatMap((result) => result.findings));
  const counts = { block: 0, warn: 0, info: 0 };
  for (const item of findings) {
    counts[item.severity] += 1;
  }
  return {
    base: query.base,
    records: checked.length,
    passed: counts.block === 0,
    counts,
    findings,
    notChecked: checked.flatMap((result) => result.skipped),
    rulesNotChecked: RULES_NOT_CHECKED,
  };
}
