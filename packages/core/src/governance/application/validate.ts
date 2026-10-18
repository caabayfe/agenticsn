import { UnknownBaseError } from "../domain/errors";
import {
  type Finding,
  type FindingSeverity,
  inherited,
  introduced,
  ordered,
} from "../domain/findings";
import { type FluentBuild, type FluentProject, fluentFindings } from "../domain/fluent-findings";
import type { DocumentedRecords, FluentProjects, MirrorState, ScriptChecker } from "../ports";
import { documentationFindings, type TouchedRecord } from "./documentation-checks";
import {
  aclFindings,
  checkVersion,
  flowFindings,
  MAX_SCRIPT_BYTES,
  type Skipped,
  undescribed,
  withRule,
} from "./record-checks";
import { type ChangedUnit, changedUnits } from "./unit-versions";

export { MAX_SCRIPT_BYTES, type Skipped };

export interface ValidateQuery {
  // What the change is compared against: a commit, branch or tag. Only findings the change
  // introduced since then are reported.
  readonly base: string;
  // Source files to check, relative to the workspace: only the projects holding them are built.
  // Every project changed since `base` when absent.
  readonly paths?: readonly string[];
  // A base per project (workspace path -> commit), in place of `base` for that project: the
  // commit that last wrote its ledger, so adopted code counts as already there (decision D).
  readonly bases?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}

export interface Validation {
  readonly base: string;
  // Units the change added or edited, checked (ADR-0031 item 6).
  readonly units: number;
  // Fluent projects built.
  readonly fluentProjects: number;
  readonly passed: boolean;
  readonly counts: Readonly<Record<FindingSeverity, number>>;
  readonly findings: readonly Finding[];
  // Findings the changed units already held at their base: shown, never blocking (decision D).
  readonly inherited: readonly Finding[];
  readonly notChecked: readonly Skipped[];
  readonly rulesNotChecked: readonly { readonly ruleId: string; readonly reason: string }[];
}

export interface ValidateDependencies {
  readonly mirror: MirrorState;
  readonly checker: ScriptChecker;
  readonly fluent: FluentProjects;
  // The workspace's documentation, when it has any (ADR-0036): pages citing what changed.
  readonly documentation?: DocumentedRecords;
}

// Rules no check covers yet, said rather than silently passed.
const RULES_NOT_CHECKED = [
  { ruleId: "SN-UPG-002", reason: "needs the inventory of customized out-of-box records" },
];

// Each application's declared privileges, read once per validation.
type Privileges = (scope: string) => Promise<readonly string[]>;

function privilegesOnce(mirror: MirrorState): Privileges {
  const read = new Map<string, Promise<readonly string[]>>();
  return (scope) => {
    if (scope === "global") return Promise.resolve([]);
    const known = read.get(scope) ?? mirror.privileges(scope);
    read.set(scope, known);
    return known;
  };
}

// The fields an edit changes; none for a unit the change adds or deletes, which affects every
// piece of evidence on the record (ADR-0039).
function edited(item: ChangedUnit): { readonly changed?: readonly string[] } {
  if (item.before === null || item.unit.head.action === "DELETE") return {};
  const before = item.before.fields;
  const now = item.now.fields;
  const names = [...new Set([...Object.keys(before), ...Object.keys(now)])];
  return { changed: names.filter((name) => before[name] !== now[name]).sort() };
}

export interface ProjectCheck {
  readonly units: number;
  readonly findings: Finding[];
  readonly inherited: Finding[];
  readonly skipped: Skipped[];
  readonly touched: TouchedRecord[];
}

async function checkUnits(
  deps: ValidateDependencies,
  privilegesOf: Privileges,
  project: { readonly path: string; readonly scope: string },
  builds: {
    readonly now: Extract<FluentBuild, { built: true }>;
    readonly base: FluentBuild | null;
  },
): Promise<ProjectCheck> {
  const base = builds.base?.built === true ? builds.base : null;
  const changed = changedUnits(project, builds.now, base);
  const privileges = await privilegesOf(project.scope);
  const findings: Finding[] = [];
  const kept: Finding[] = [];
  const skipped: Skipped[] = [];
  const touched: TouchedRecord[] = [];
  const units = { now: builds.now.units, base: base?.units ?? [] };
  for (const item of changed) {
    const path = `${project.path}/${item.unit.updateName}`;
    const source = Object.values(item.now.files)[0] ?? path;
    touched.push({
      table: item.unit.head.table,
      sysId: item.unit.head.sysId,
      source,
      ...edited(item),
    });
    findings.push(...aclFindings(item, path, units), ...flowFindings(item, path));
    if (item.unit.head.action === "DELETE") continue;
    const current = checkVersion(deps.checker, item.now, privileges);
    const previous =
      item.before === null ? [] : checkVersion(deps.checker, item.before, privileges).findings;
    findings.push(...introduced(current.findings, previous));
    kept.push(...inherited(current.findings, previous));
    if (item.before === null) findings.push(...undescribed(path, item.now));
    skipped.push(...current.skipped);
  }
  // Paths name source files and units, relative to the workspace.
  const inWorkspace = (list: Finding[]) => list.map((f): Finding => ({ ...f, root: "workspace" }));
  return {
    units: changed.length,
    findings: inWorkspace(findings),
    inherited: inWorkspace(kept),
    skipped,
    touched,
  };
}

// The project folder is named after its scope (source/<scope>).
const scopeOf = (project: FluentProject) => project.path.slice(project.path.lastIndexOf("/") + 1);

async function checkProject(
  deps: ValidateDependencies,
  privilegesOf: Privileges,
  project: FluentProject,
  commit: string,
): Promise<ProjectCheck> {
  const build = await deps.fluent.build(project);
  const findings: Finding[] = fluentFindings(
    project,
    build,
    await deps.fluent.sdkVersion(),
  ).flatMap((hit) => withRule(hit.ruleId, { ...hit, root: "workspace", field: null }));
  if (!build.built) return { units: 0, findings, inherited: [], skipped: [], touched: [] };
  const base = await deps.fluent.buildAt(project, commit);
  const scope = { path: project.path, scope: scopeOf(project) };
  const units = await checkUnits(deps, privilegesOf, scope, { now: build, base });
  return { ...units, findings: [...findings, ...units.findings] };
}

// Edits to the mirror: never delivered, lost at the next integrate (ADR-0031 item 2).
async function mirrorEdits(mirror: MirrorState): Promise<Finding[]> {
  return (await mirror.edited()).flatMap((path) =>
    withRule("SN-MNT-013", {
      path,
      root: "workspace",
      field: null,
      line: null,
      message: "the mirror is read-only: adopt the record and edit its Fluent source",
      evidence: "",
    }),
  );
}

// The Fluent projects the change touched since `base` (or holding `paths`), each built and
// checked.
export async function checkSince(
  deps: ValidateDependencies,
  query: ValidateQuery,
): Promise<{
  readonly resolved: string;
  readonly projects: readonly FluentProject[];
  readonly checked: ProjectCheck[];
}> {
  const resolved = await deps.mirror.resolve(query.base);
  if (resolved === null) {
    throw new UnknownBaseError(query.base);
  }
  const projects =
    query.paths === undefined
      ? await deps.fluent.changedSince(resolved)
      : await deps.fluent.holding(query.paths);
  const privilegesOf = privilegesOnce(deps.mirror);
  const checked: ProjectCheck[] = [];
  for (const project of projects) {
    const own = query.bases?.[project.path];
    const base = own === undefined ? resolved : await deps.mirror.resolve(own);
    if (base === null) throw new UnknownBaseError(own ?? query.base);
    checked.push(await checkProject(deps, privilegesOf, project, base));
  }
  return { resolved, projects, checked };
}

// Checks what the change did to the workspace's Fluent source against the rules, reporting only
// what it introduced since `base`, refuses edits to the mirror, and names the documentation pages
// the change may make wrong.
export async function validate(
  deps: ValidateDependencies,
  query: ValidateQuery,
): Promise<Validation> {
  const { resolved, projects, checked } = await checkSince(deps, query);
  const edits = query.paths === undefined ? await mirrorEdits(deps.mirror) : [];
  const documented =
    deps.documentation === undefined
      ? []
      : await documentationFindings(
          deps.documentation,
          { base: resolved, touched: checked.flatMap((c) => c.touched) },
          query.signal ?? new AbortController().signal,
        );
  const findings = ordered([...edits, ...checked.flatMap((c) => c.findings), ...documented]);
  const counts = { block: 0, warn: 0, info: 0 };
  for (const item of findings) {
    counts[item.severity] += 1;
  }
  return {
    base: query.base,
    units: checked.reduce((sum, c) => sum + c.units, 0),
    fluentProjects: projects.length,
    passed: counts.block === 0,
    counts,
    findings,
    inherited: ordered(checked.flatMap((c) => c.inherited)),
    notChecked: checked.flatMap((c) => c.skipped),
    rulesNotChecked: RULES_NOT_CHECKED,
  };
}
