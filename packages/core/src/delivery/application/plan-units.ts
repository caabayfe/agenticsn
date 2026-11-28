import type { AuthoringWorkspace, FluentToolchain } from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import type { Finding, ValidateDependencies } from "../../governance/index";
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
import type { CaptureDecoder, DeliveryWorkspace, PushJournal, PushJournalStore } from "../ports";
import { planNext } from "./delivery-next";
import { withoutCutValues } from "./field-lengths";
import { gateFor } from "./plan-gate";
import { deliveryTarget, orphanedPending, pendingJournal } from "./plan-pending";
import { type ProjectLoad, planProject } from "./plan-project";
import { withoutUnscopedChanges } from "./unscoped-changes";

export type { ProjectLoad } from "./plan-project";

// What a push would load, and whether it may (ADR-0031, ADR-0033): every project under source/
// built, each unit whose build moved away from its ledger entry compared with the instance's
// live copy, gated by validate and waivers, checked for collisions with open update sets.

export interface UnitPlanQuery {
  readonly instance: string;
  // Names the branch's batch of update sets (domain/batch). Default: the git branch.
  readonly label?: string;
  readonly allowCollisions: boolean;
  readonly recoverPending?: boolean;
}

export interface UnitPlanDependencies {
  // Live ensure facts already observed missing by the installer (ADR-0042).
  readonly recheckUnits?: readonly string[];
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
    "branch" | "mirrorCommit" | "uncommittedSource" | "waivers" | "reviewedWaivers" | "metadataRoot"
  >;
  // Team mode (ADR-0058): the shared mirror's git remote; the gate accepts only waivers on its
  // default branch.
  readonly reviewedRemote?: string;
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
  readonly recoverPending?: boolean;
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

async function projectPlans(
  deps: UnitPlanDependencies,
  query: UnitPlanQuery,
  journal: PushJournal | null,
) {
  const built: ProjectLoad[] = [];
  const problems: UnitProblem[] = [];
  const userDomain = sessionDomain(deps);
  for (const project of await deps.authoring.workspace.projects()) {
    const planned = await planProject(
      deps,
      project,
      query.instance,
      userDomain,
      (journal?.pending ?? []).filter((entry) => entry.project === project.path),
      query.recoverPending === true,
    );
    if (planned.load !== null) built.push(planned.load);
    problems.push(...planned.problems);
  }
  return { built, problems };
}

export async function computeUnitPlan(
  deps: UnitPlanDependencies,
  query: UnitPlanQuery,
): Promise<{ readonly plan: UnitPushPlan; readonly loads: readonly ProjectLoad[] }> {
  const { label, ...pending } = await pendingJournal(
    deps,
    query.instance,
    query.label,
    query.recoverPending,
  );
  const { built, problems } = await projectPlans(deps, query, pending.journal);
  problems.push(...(await uncommittedSource(deps)), ...pending.problems);
  problems.push(...orphanedPending(pending.journal, built));
  const scoped = await withoutUnscopedChanges(deps.reader, built, deps.signal);
  problems.push(...scoped.problems);
  const { loads, problems: cut } = await withoutCutValues(deps.reader, scoped.loads, deps.signal);
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
  const id = unitPlanId(
    units,
    gate,
    deliveryTarget(deps, query.instance, label, pending.journal, query.recoverPending),
  );
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
    ...(query.recoverPending ? { recoverPending: true } : {}),
    next: planNext(query, { label, planId: id, ready, gatePassed: gate.passed, base }),
  };
  return { plan, loads };
}
