import {
  type Rule,
  ruleById,
  rulesForScript,
  type ScriptKind,
  scriptFieldsOf,
} from "../../advice/index";
import { BEHAVIOR_CLASSES, baseOfFile } from "../../knowledge/index";
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
  field: string,
  kind: ScriptKind,
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

function checkVersion(checker: ScriptChecker, version: RecordVersion): Checked {
  const scripts = Object.entries(scriptFieldsOf(version.className, version.fields)).filter(
    ([field]) => (version.fields[field] ?? "").trim() !== "",
  );
  const checked = scripts.map(([field, kind]) => checkScript(checker, version, field, kind));
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

async function checkRecord(deps: ValidateDependencies, commit: string, base: string) {
  const now = await deps.records.current(base);
  if (now === null) {
    return null;
  }
  const before = await deps.records.at(commit, base);
  const current = checkVersion(deps.checker, now);
  const previous = before === null ? [] : checkVersion(deps.checker, before).findings;
  return {
    findings: [
      ...introduced(current.findings, previous),
      ...(before === null ? undescribed(base, now) : []),
    ],
    skipped: current.skipped,
  };
}

// Checks the changed records against the rules, reporting only what the change introduced.
export async function validate(
  deps: ValidateDependencies,
  query: ValidateQuery,
): Promise<Validation> {
  const commit = await deps.records.resolve(query.base);
  if (commit === null) {
    throw new UnknownBaseError(query.base);
  }
  const bases =
    query.paths === undefined
      ? await deps.records.changedSince(commit)
      : [...new Set(query.paths.map(baseOfFile))].sort();
  const results = [];
  for (const base of bases) {
    results.push(await checkRecord(deps, commit, base));
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
