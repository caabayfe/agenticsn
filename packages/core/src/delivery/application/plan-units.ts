import { readUnits } from "../../authoring/application/read-units";
import { unitDigest } from "../../authoring/domain/digest";
import type { Ledger, LedgerEntry } from "../../authoring/domain/ledger";
import { type BuiltUnit, isDeletion } from "../../authoring/domain/unit";
import { pendingFor } from "../../authoring/index";
import type { AuthoringWorkspace, FluentToolchain, SourceProject } from "../../authoring/ports";
import type { InstanceReader } from "../../connection/ports";
import type { Finding, ValidateDependencies } from "../../governance/index";
import { InvalidInputError } from "../../kernel/errors";
import { SESSION_USER } from "../../kernel/session-user";
import { TableName } from "../../kernel/table-name";
import type { NextCall } from "../../knowledge/index";
import {
  heldInOpenUpdateSets,
  type RecordHolder,
  type UpdateSetDependencies,
} from "../../updatesets/index";
import { batchUpdateSets, inBatch } from "../domain/batch";
import type { GateResult } from "../domain/gate";
import { type PlannedUnit, type UnitProblem, unitPlanId } from "../domain/unit-plan";
import type {
  CaptureDecoder,
  DeliveryWorkspace,
  PendingDelivery,
  PushJournalStore,
} from "../ports";
import { withoutCutValues } from "./field-lengths";
import { planCandidate } from "./plan-candidate";
import { gateFor } from "./plan-gate";
import { deliveryTarget, orphanedPending, pendingJournal } from "./plan-pending";
import { removedDefinitions } from "./removed-definitions";

// What a push would load, and whether it may (ADR-0031, ADR-0033): every project under source/
// built, each unit whose build moved away from its ledger entry compared with the instance's
// live copy, gated by validate and waivers, checked for collisions with open update sets.

export interface UnitPlanQuery {
  readonly instance: string;
  // Names the branch's batch of update sets (domain/batch). Default: the git branch.
  readonly label?: string;
  readonly allowCollisions: boolean;
}

export interface UnitPlanDependencies {
  readonly authoring: {
    readonly workspace: AuthoringWorkspace;
    readonly toolchain: FluentToolchain;
  };
  readonly reader: InstanceReader;
  readonly journal?: PushJournalStore;
  readonly url?: string;
  readonly decodeCapture?: CaptureDecoder;
  readonly workspace: Pick<
    DeliveryWorkspace,
    "branch" | "mirrorCommit" | "uncommittedSource" | "waivers" | "metadataRoot"
  >;
  readonly governance: ValidateDependencies;
  readonly packGate?: (
    paths: readonly string[],
    units: readonly { readonly project: string; readonly sysId: string }[],
  ) => Promise<readonly Finding[]>;
  readonly updateSets: UpdateSetDependencies;
  readonly now: () => Date;
  readonly signal: AbortSignal;
}

// A unit someone holds in another open update set.
export interface HeldRecord {
  readonly path: string;
  readonly record: string;
  readonly heldBy: readonly RecordHolder[];
}

export interface UnitPushPlan {
  readonly instance: string;
  readonly planId: string;
  readonly label: string;
  readonly updateSets: readonly string[];
  readonly units: readonly PlannedUnit[];
  readonly problems: readonly UnitProblem[];
  readonly gate: GateResult;
  readonly collisions: readonly HeldRecord[];
  readonly ready: boolean;
  readonly next: readonly NextCall[];
}

// One project's share of a plan: what push loads, and what it reads back.
export interface ProjectLoad {
  readonly project: SourceProject;
  readonly ledger: Ledger;
  readonly units: readonly PlannedUnit[];
  // Built units and their XML, by update name, for the units planned.
  readonly built: ReadonlyMap<string, { readonly unit: BuiltUnit; readonly xml: string }>;
}

// The label is part of an encoded query (^ separates terms) and of "[<scope>]".
function checkedLabel(label: string): string {
  if (/[\^\r\n[\]]/.test(label)) {
    throw new InvalidInputError("label must not contain ^ [ ] or line breaks");
  }
  return label;
}

const problem = (project: string, kind: UnitProblem["kind"], reason: string, name = "") => ({
  project: project,
  updateName: name,
  kind,
  reason,
});

// The signed-in user's domain, read once per plan and only when a flow would be loaded.
function sessionDomain(deps: UnitPlanDependencies): () => Promise<string> {
  let domain: Promise<string> | undefined;
  return () => {
    domain ??= deps.reader
      .query(
        {
          table: TableName.parse("sys_user"),
          query: `sys_id=${SESSION_USER}`,
          fields: ["sys_domain"],
          limit: 1,
        },
        deps.signal,
      )
      .then((rows) => rows[0]?.["sys_domain"] || "global");
    return domain;
  };
}

async function planProject(
  deps: UnitPlanDependencies,
  project: SourceProject,
  instance: string,
  userDomain: () => Promise<string>,
  pending: readonly PendingDelivery[],
): Promise<{ load: ProjectLoad | null; problems: UnitProblem[] }> {
  const build = await deps.authoring.toolchain.build(project);
  if (!build.ok) return { load: null, problems: [problem(project.path, "build", build.message)] };
  const ledger = await deps.authoring.workspace.readLedger(project);
  const entries = ledger.get(instance) ?? new Map<string, LedgerEntry>();
  const digests = new Map(build.units.map((unit) => [unit.updateName, unitDigest(unit)]));
  const candidates = build.units.filter(
    (unit) =>
      isDeletion(unit) ||
      entries.get(unit.updateName)?.build !== digests.get(unit.updateName) ||
      pendingFor(pending, unit, digests.get(unit.updateName) ?? "") !== undefined,
  );
  const copies = await readUnits(deps.reader, candidates, deps.signal);
  const deleted = new Map(
    candidates
      .filter(isDeletion)
      .map((unit) => [
        unit.updateName,
        copies.get(unit.updateName)?.head["sys_update_name"] ?? null,
      ]),
  );
  const removed = await removedDefinitions(
    deps.reader,
    deps.signal,
    project,
    entries,
    build.units,
    new Set(deleted.values()),
  );
  const units: PlannedUnit[] = [...removed.forgotten];
  const problems = removed.problems;
  for (const unit of candidates) {
    const outcome = await planCandidate(unit, {
      project,
      entries,
      digest: digests.get(unit.updateName) ?? "",
      copy: copies.get(unit.updateName) ?? null,
      pending,
      removes: deleted.get(unit.updateName) ?? null,
      userDomain,
      reader: deps.reader,
      decodeCapture: deps.decodeCapture,
      signal: deps.signal,
    });
    if (outcome === null) continue;
    if (!("operation" in outcome)) problems.push(outcome);
    else units.push(outcome);
  }
  const built = new Map(
    candidates.map((unit) => [unit.updateName, { unit, xml: build.files.get(unit.file) ?? "" }]),
  );
  return { load: { project, ledger, units, built }, problems };
}

async function collisionsOf(
  deps: UnitPlanDependencies,
  units: readonly PlannedUnit[],
  label: string,
) {
  const loaded = units.filter((unit) => unit.operation !== "record" && unit.operation !== "forget");
  const held = await heldInOpenUpdateSets(
    deps.updateSets,
    loaded.map((u) => u.updateName),
    deps.signal,
  );
  return loaded.flatMap((unit): HeldRecord[] => {
    const others = (held.get(unit.updateName) ?? []).filter(
      (h) => !inBatch(label, h.updateSetName),
    );
    return others.length === 0
      ? []
      : [{ path: unit.project, record: unit.updateName, heldBy: others }];
  });
}

async function uncommittedSource(deps: UnitPlanDependencies): Promise<UnitProblem[]> {
  const files = await deps.workspace.uncommittedSource();
  return files.length === 0
    ? []
    : [problem("source", "build", `commit the source first: ${files.slice(0, 5).join(", ")}`)];
}

// Each project's ledger commit, where it last agreed with the instance (adopt or push): the
// gate's base for it (decision D). A project with no committed ledger keeps the plan's base.
// Each project's ledger commit; a project the push would load with none never agreed with the
// instance, so its base is null and the gate judges all of it.
async function ledgerBases(
  deps: UnitPlanDependencies,
  loading: readonly string[],
): Promise<Record<string, string | null>> {
  const bases: Record<string, string | null> = {};
  for (const project of await deps.authoring.workspace.projects()) {
    const commit = await deps.authoring.workspace.ledgerCommit(project).catch(() => null);
    if (commit !== null) bases[project.path] = commit;
    else if (loading.includes(project.path)) bases[project.path] = null;
  }
  return bases;
}

export async function computeUnitPlan(
  deps: UnitPlanDependencies,
  query: UnitPlanQuery,
): Promise<{ readonly plan: UnitPushPlan; readonly loads: readonly ProjectLoad[] }> {
  const label = checkedLabel(query.label ?? (await deps.workspace.branch()));
  const built: ProjectLoad[] = [];
  const problems: UnitProblem[] = await uncommittedSource(deps);
  const pending = await pendingJournal(deps, query.instance, label);
  problems.push(...pending.problems);
  const userDomain = sessionDomain(deps);
  for (const project of await deps.authoring.workspace.projects()) {
    const planned = await planProject(
      deps,
      project,
      query.instance,
      userDomain,
      (pending.journal?.pending ?? []).filter((entry) => entry.project === project.path),
    );
    if (planned.load !== null) built.push(planned.load);
    problems.push(...planned.problems);
  }
  problems.push(...orphanedPending(pending.journal, built));
  const { loads, problems: cut } = await withoutCutValues(deps.reader, built, deps.signal);
  problems.push(...cut);
  const units = loads.flatMap((load) => load.units);
  const base = (await deps.workspace.mirrorCommit()) ?? "HEAD";
  const loading = [...new Set(units.map((u) => u.project))];
  const gated = units.map((u) => ({ project: u.project, sysId: u.sysId }));
  const gate = await gateFor(deps, base, loading, await ledgerBases(deps, loading), gated);
  const collisions = await collisionsOf(deps, units, label);
  const ready =
    units.length > 0 &&
    problems.length === 0 &&
    gate.passed &&
    (collisions.length === 0 || query.allowCollisions);
  const id = unitPlanId(units, gate, deliveryTarget(deps, query.instance, label, pending.journal));
  const plan: UnitPushPlan = {
    instance: query.instance,
    planId: id,
    label,
    updateSets: batchUpdateSets(
      label,
      units.map((unit) => unit.scope),
    ),
    units,
    problems,
    gate,
    collisions,
    ready,
    next: ready
      ? [{ tool: "push", args: { instance: query.instance, label, plan: id, confirm: true } }]
      : gate.passed
        ? []
        : [{ tool: "validate", args: { base } }],
  };
  return { plan, loads };
}
