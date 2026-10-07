import { type ValidateDependencies, validate } from "../../governance/index";
import { InvalidInputError } from "../../kernel/errors";
import type { NextCall } from "../../knowledge/index";
import { baseOfFile } from "../../knowledge/index";
import { parseRecord } from "../../metadata/domain/record-layout";
import {
  heldInOpenUpdateSets,
  type RecordHolder,
  type UpdateSetDependencies,
} from "../../updatesets/index";
import { batchUpdateSets, inBatch } from "../domain/batch";
import { changeOf, type ParsedRecord, type PlannedWrite, type PlanProblem } from "../domain/change";
import { MirrorNotIntegratedError, NothingPulledYetError } from "../domain/errors";
import { type GateResult, gateOf, planId } from "../domain/gate";
import { readWaivers, UNCOMMITTED_WAIVERS } from "../domain/waivers";
import type { DeliveryWorkspace } from "../ports";

export interface PlanQuery {
  readonly instance: string;
  // Names the branch's batch of update sets (domain/batch). Default: the git branch.
  readonly label?: string;
  readonly allowCollisions: boolean;
}

export interface PlanDependencies {
  readonly workspace: DeliveryWorkspace;
  readonly governance: ValidateDependencies;
  readonly updateSets: UpdateSetDependencies;
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
  }[];
  readonly problems: readonly PlanProblem[];
  readonly gate: GateResult;
  readonly collisions: readonly HeldRecord[];
  // Nothing stands in the way of push.
  readonly ready: boolean;
  readonly next: readonly NextCall[];
}

const CONFLICT = /^(<{7}|>{7}|={7})( |$)/m;
const isChildRows = (path: string) => /\.children\.[^/]+\.yaml$/.test(path);

async function parsed(
  deps: PlanDependencies,
  base: string,
  at: string | null,
): Promise<ParsedRecord | null> {
  const stored = await deps.workspace.read(base, at);
  return stored === null ? null : parseRecord(stored.document, stored.files);
}

async function writesAndProblems(deps: PlanDependencies, commit: string) {
  const files = await deps.workspace.changedFiles(commit);
  const problems: PlanProblem[] = files.filter(isChildRows).map((path) => ({
    path,
    reason: "child rows are read-only: change the record that owns them",
  }));
  for (const path of files) {
    if (CONFLICT.test((await deps.workspace.text(path)) ?? "")) {
      problems.push({ path, reason: "conflict markers remain: resolve the merge first" });
    }
  }
  const writes: PlannedWrite[] = [];
  for (const base of [...new Set(files.filter((p) => !isChildRows(p)).map(baseOfFile))].sort()) {
    try {
      const outcome = changeOf(
        `${base}.yaml`,
        await parsed(deps, base, commit),
        await parsed(deps, base, null),
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
  return { writes, problems };
}

async function collisionsOf(
  deps: PlanDependencies,
  writes: readonly PlannedWrite[],
  label: string,
): Promise<HeldRecord[]> {
  const names = writes.map((write) => `${write.table}_${write.sysId}`);
  const held = await heldInOpenUpdateSets(deps.updateSets, names, deps.signal);
  return writes.flatMap((write) => {
    const record = `${write.table}_${write.sysId}`;
    const others = (held.get(record) ?? []).filter((h) => !inBatch(label, h.updateSetName));
    return others.length === 0 ? [] : [{ path: write.path, record, heldBy: others }];
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

export async function computePlan(
  deps: PlanDependencies,
  query: PlanQuery,
): Promise<{ readonly plan: PushPlan; readonly writes: readonly PlannedWrite[] }> {
  const commit = await deps.workspace.mirrorCommit();
  if (commit === null) {
    throw new NothingPulledYetError(query.instance);
  }
  if (!(await deps.workspace.includes(commit))) {
    throw new MirrorNotIntegratedError(query.instance);
  }
  const label = checkedLabel(query.label ?? (await deps.workspace.branch()));
  const { writes, problems } = await writesAndProblems(deps, commit);
  const validation = await validate(deps.governance, { base: commit });
  const waiverFile = await deps.workspace.waivers();
  const { waivers, problems: read } = readWaivers(waiverFile.committed, deps.now());
  const waiverProblems = waiverFile.uncommitted ? [UNCOMMITTED_WAIVERS, ...read] : read;
  const gate = gateOf(validation.findings, waivers, waiverProblems, deps.workspace.metadataRoot);
  const collisions = await collisionsOf(deps, writes, label);
  const ready =
    writes.length > 0 &&
    problems.length === 0 &&
    gate.passed &&
    (collisions.length === 0 || query.allowCollisions);
  const id = planId(commit, writes, gate);
  const plan: PushPlan = {
    instance: query.instance,
    planId: id,
    mirrorCommit: commit,
    label,
    updateSets: batchUpdateSets(
      label,
      writes.map((write) => write.scope),
    ),
    changes: writes.map(({ values, baseHash, ...change }) => ({
      ...change,
      fields: Object.keys(values),
    })),
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
  return { plan, writes };
}
