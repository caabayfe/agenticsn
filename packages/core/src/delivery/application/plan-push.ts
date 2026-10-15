import type { Finding, ValidateDependencies } from "../../governance/index";
import { InvalidInputError } from "../../kernel/errors";
import type { NextCall } from "../../knowledge/index";
import { baseOfFile } from "../../knowledge/index";
import {
  heldInOpenUpdateSets,
  type RecordHolder,
  type UpdateSetDependencies,
} from "../../updatesets/index";
import { batchUpdateSets, inBatch } from "../domain/batch";
import { changeOf, needsElevation, type PlannedWrite, type PlanProblem } from "../domain/change";
import { childRowChanges, type RowOwner } from "../domain/child-rows";
import { MirrorNotIntegratedError, NothingPulledYetError } from "../domain/errors";
import { type GateResult, planId } from "../domain/gate";
import type { PlannedList } from "../domain/list-changes";
import { pushUnfinished, writeOrder } from "../domain/write-order";
import type { DeliveryWorkspace, FluentPackage, FluentPackages, PushJournalStore } from "../ports";
import { type FluentPlan, planFluent } from "./plan-fluent";
import { gateFor } from "./plan-gate";
import { isListFile, planLists } from "./plan-lists";
import { parsed, pulledCopy } from "./plan-records";

export interface PlanQuery {
  readonly instance: string;
  // Names the branch's batch of update sets (domain/batch). Default: the git branch.
  readonly label?: string;
  readonly allowCollisions: boolean;
}

export interface PlanDependencies {
  readonly workspace: DeliveryWorkspace;
  // Accelerator pack findings for the planned paths (ADR-0026: the gate's pack check).
  readonly packGate?: (paths: readonly string[]) => Promise<readonly Finding[]>;
  // Fluent projects, built for delivery (ADR-0028 as amended); none when absent.
  readonly fluent?: FluentPackages;
  // A push that stopped part way leaves its journal until a pull shows what it wrote.
  readonly journal: Pick<PushJournalStore, "read">;
  readonly governance: ValidateDependencies;
  readonly updateSets: UpdateSetDependencies;
  // A person opted the instance into writes through an elevated session (ADR-0024).
  readonly elevation: boolean;
  readonly now: () => Date;
  readonly signal: AbortSignal;
}

export interface HeldRecord {
  readonly path: string;
  readonly record: string;
  readonly heldBy: readonly RecordHolder[];
}

export interface PushPlan {
  readonly instance: string;
  readonly planId: string;
  readonly mirrorCommit: string;
  readonly label: string;
  readonly updateSets: readonly string[];
  readonly changes: readonly {
    readonly operation: PlannedWrite["operation"];
    readonly table: string;
    readonly sysId: string;
    readonly scope: string;
    readonly path: string;
    readonly fields: readonly string[];
    // Written through a session elevated to security_admin (ADR-0024).
    readonly elevated: boolean;
  }[];
  // Each list layout, loaded whole as one List Layout update (ADR-0029), columns in order.
  readonly lists: readonly ReturnType<typeof listChangeOf>[];
  // Each flow, subflow, action and other record a Fluent project's build installs: loaded
  // into the batch and published (ADR-0028 as amended).
  readonly fluent: readonly {
    readonly project: string;
    readonly scope: string;
    readonly table: string;
    readonly sysId: string;
    readonly name: string;
    readonly kind: string;
  }[];
  readonly problems: readonly PlanProblem[];
  readonly gate: GateResult;
  readonly collisions: readonly HeldRecord[];
  // Nothing stands in the way of push.
  readonly ready: boolean;
  readonly next: readonly NextCall[];
}

const CONFLICT = /^(<{7}|>{7}|={7})( |$)/m;
const CHILD_SUFFIX = /\.children\.[^/]+\.yaml$/;
const isChildRows = (path: string) => CHILD_SUFFIX.test(path);

// The record whose file holds a child-row file's rows, as it is in the working tree.
async function rowOwner(deps: PlanDependencies, path: string): Promise<RowOwner | null> {
  const owner = await parsed(deps.workspace, path.replace(CHILD_SUFFIX, ""), null).catch(
    () => null,
  );
  if (owner === null) {
    return null;
  }
  const { identity, fields } = owner.artifact;
  return {
    table: identity.className,
    sysId: identity.sysId,
    scope: identity.scope,
    name: fields["name"] ?? "",
  };
}

// Child rows the user edited (ADR-0025), compared with the file as last pulled.
async function childRowWrites(deps: PlanDependencies, files: readonly string[], commit: string) {
  const writes: PlannedWrite[] = [];
  const problems: PlanProblem[] = [];
  for (const path of files.filter(isChildRows)) {
    const outcome = childRowChanges(
      path,
      await rowOwner(deps, path),
      await deps.workspace.document(path, commit),
      await deps.workspace.document(path, null),
    );
    writes.push(...outcome.writes);
    problems.push(...outcome.problems);
  }
  return { writes, problems };
}

async function writesAndProblems(deps: PlanDependencies, commit: string, instance: string) {
  const changed = await deps.workspace.changedFiles(commit);
  // A list is delivered whole (ADR-0029), never as a record and rows.
  const files = changed.filter((path) => !isListFile(path));
  const listed = await planLists(deps.workspace, changed, commit);
  const rows = await childRowWrites(deps, files, commit);
  const problems: PlanProblem[] = [...listed.problems, ...rows.problems];
  for (const path of changed) {
    if (CONFLICT.test((await deps.workspace.text(path)) ?? "")) {
      problems.push({ path, reason: "conflict markers remain: resolve the merge first" });
    }
  }
  const writes: PlannedWrite[] = [...rows.writes];
  for (const base of [...new Set(files.filter((p) => !isChildRows(p)).map(baseOfFile))].sort()) {
    try {
      const outcome = changeOf(
        `${base}.yaml`,
        await pulledCopy(deps.workspace, base, commit),
        await parsed(deps.workspace, base, null),
        { elevation: deps.elevation },
      );
      if (outcome.kind === "write") {
        writes.push(outcome.write);
      } else if (outcome.kind === "problem") {
        problems.push(outcome.problem);
      }
    } catch (error) {
      problems.push({ path: `${base}.yaml`, reason: `cannot read the record: ${String(error)}` });
    }
  }
  const journal = await deps.journal.read();
  if (pushUnfinished(journal, commit)) {
    problems.push({
      path: "",
      reason: `push ${journal?.planId} stopped part way: run snagentic pull ${instance}, then integrate, before planning again`,
    });
  }
  return { writes: writeOrder(writes), lists: listed.lists, problems };
}

// Update records others hold: a record under <table>_<sys_id>, a list under its update name.
async function collisionsOf(
  deps: PlanDependencies,
  planned: { readonly writes: readonly PlannedWrite[]; readonly lists: readonly PlannedList[] },
  label: string,
): Promise<HeldRecord[]> {
  const entries = [
    ...planned.writes.map((w) => ({ path: w.path, record: `${w.table}_${w.sysId}` })),
    ...planned.lists.map((l) => ({ path: l.path, record: l.updateName })),
  ];
  const names = entries.map((entry) => entry.record);
  const held = await heldInOpenUpdateSets(deps.updateSets, names, deps.signal);
  return entries.flatMap(({ path, record }) => {
    const others = (held.get(record) ?? []).filter((h) => !inBatch(label, h.updateSetName));
    return others.length === 0 ? [] : [{ path, record, heldBy: others }];
  });
}

// What a push would do, and whether it may (spec 004): the working tree against the mirror,
// gated by validate and waivers, checked for collisions with open update sets.
// The label is part of an encoded query (^ separates terms) and of "[<scope>]".
function checkedLabel(label: string): string {
  if (/[\^\r\n[\]]/.test(label)) {
    throw new InvalidInputError("label must not contain ^ [ ] or line breaks");
  }
  return label;
}

const listChangeOf = ({ operation, scope, path, layout }: PlannedList) => ({
  operation,
  scope,
  table: layout.table,
  view: layout.view.name || layout.view.sysId,
  sysId: layout.sysId,
  path,
  columns: layout.columns.map((c) => c.element),
});

const fluentChanges = (records: FluentPlan["records"]) =>
  records.map(({ project, scope, table, sysId, name, kind }) => ({
    project,
    scope,
    table,
    sysId,
    name,
    kind,
  }));

export async function computePlan(
  deps: PlanDependencies,
  query: PlanQuery,
): Promise<{
  readonly plan: PushPlan;
  readonly writes: readonly PlannedWrite[];
  readonly lists: readonly PlannedList[];
  readonly fluent: readonly FluentPackage[];
}> {
  const commit = await deps.workspace.mirrorCommit();
  if (commit === null) {
    throw new NothingPulledYetError(query.instance);
  }
  if (!(await deps.workspace.includes(commit))) {
    throw new MirrorNotIntegratedError(query.instance);
  }
  const label = checkedLabel(query.label ?? (await deps.workspace.branch()));
  const changed = await writesAndProblems(deps, commit, query.instance);
  const fluent = await planFluent(deps, commit);
  const { writes, lists } = changed;
  const problems = [...changed.problems, ...fluent.problems];
  const gate = await gateFor(
    deps,
    commit,
    [...writes, ...lists].map((w) => w.path),
  );
  const collisions = await collisionsOf(deps, { writes, lists }, label);
  const ready =
    writes.length + lists.length + fluent.packages.length > 0 &&
    problems.length === 0 &&
    gate.passed &&
    (collisions.length === 0 || query.allowCollisions);
  const id = planId(commit, writes, gate, fluent.packages, lists);
  const plan: PushPlan = {
    instance: query.instance,
    planId: id,
    mirrorCommit: commit,
    label,
    updateSets: batchUpdateSets(label, [
      ...writes.map((write) => write.scope),
      ...lists.map((list) => list.scope),
      ...fluent.packages.map((p) => p.scope),
    ]),
    changes: writes.map(({ values, baseHash, ...change }) => ({
      ...change,
      fields: Object.keys(values),
      elevated: needsElevation(change.table),
    })),
    lists: lists.map(listChangeOf),
    fluent: fluentChanges(fluent.records),
    problems,
    gate,
    collisions,
    ready,
    next: ready
      ? [{ tool: "push", args: { instance: query.instance, plan: id, confirm: true } }]
      : gate.passed
        ? []
        : [{ tool: "validate", args: { base: commit } }],
  };
  return { plan, writes, lists, fluent: fluent.packages };
}
