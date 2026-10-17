import { readUnits } from "../../authoring/application/read-units";
import { unitDigest } from "../../authoring/domain/digest";
import type { Ledger, LedgerEntry } from "../../authoring/domain/ledger";
import { planUnit } from "../../authoring/domain/plan-unit";
import { type BuiltUnit, type InstanceCopy, isDeletion } from "../../authoring/domain/unit";
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
import {
  deletionFor,
  type PlannedUnit,
  plannedOrProblem,
  type UnitProblem,
  unitPlanId,
} from "../domain/unit-plan";
import type { DeliveryWorkspace } from "../ports";
import { gateFor } from "./plan-gate";

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
  readonly workspace: Pick<
    DeliveryWorkspace,
    "branch" | "mirrorCommit" | "uncommittedSource" | "waivers" | "metadataRoot"
  >;
  readonly governance: ValidateDependencies;
  readonly packGate?: (paths: readonly string[]) => Promise<readonly Finding[]>;
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

// A definition the ledger holds that the build no longer makes, with no Now.del for it
// (ADR-0031 item 7): a configuration project never deletes, so the record would silently stay.
function removedWithoutDeletion(
  project: SourceProject,
  entries: ReadonlyMap<string, LedgerEntry>,
  units: readonly BuiltUnit[],
  deleting: ReadonlySet<string | null>,
): UnitProblem[] {
  const built = new Set(units.map((unit) => unit.updateName));
  return [...entries.keys()]
    .filter((name) => !built.has(name) && !deleting.has(name))
    .map((name) => {
      const line = deletionFor(name);
      const add = line === null ? "add a Now.del" : `add ${line}`;
      // A removed entry of a typed array (a UI action's role) is a unit of its own: the SDK
      // emits no deletion for it (spec 009 B2).
      return problem(
        project.path,
        "removed",
        `its definition was removed: ${add} to delete it on the instance, or restore it`,
        name,
      );
    });
}

// The platform refuses to publish a flow its publishing user's domain cannot see (spike S11),
// leaving the loaded flow an inactive draft: such a flow is never loaded.
const COMPILED = new Set(["sys_hub_flow", "sys_hub_action_type_definition"]);

function outsideDomain(unit: PlannedUnit, copy: InstanceCopy | null, userDomain: string) {
  const domain = copy?.head["sys_domain"] ?? "global";
  return unit.operation === "load" && COMPILED.has(unit.table) && domain !== userDomain;
}

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
): Promise<{ load: ProjectLoad | null; problems: UnitProblem[] }> {
  const build = await deps.authoring.toolchain.build(project);
  if (!build.ok) return { load: null, problems: [problem(project.path, "build", build.message)] };
  const ledger = await deps.authoring.workspace.readLedger(project);
  const entries = ledger.get(instance) ?? new Map<string, LedgerEntry>();
  const digests = new Map(build.units.map((unit) => [unit.updateName, unitDigest(unit)]));
  const candidates = build.units.filter(
    (unit) =>
      isDeletion(unit) || entries.get(unit.updateName)?.build !== digests.get(unit.updateName),
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
  const units: PlannedUnit[] = [];
  const problems = removedWithoutDeletion(project, entries, build.units, new Set(deleted.values()));
  for (const unit of candidates) {
    const copy = copies.get(unit.updateName) ?? null;
    const entry = entries.get(unit.updateName);
    const digest = digests.get(unit.updateName) ?? "";
    const outcome = plannedOrProblem(planUnit(unit, digest, copy, entry), unit, {
      project: project.path,
      scope: project.scope,
      scopeId: project.scopeId,
      digest,
      ledger: entry?.instance ?? null,
      version: copy?.version ?? null,
      removes: deleted.get(unit.updateName) ?? null,
    });
    if (outcome === null) continue;
    if (!("operation" in outcome)) problems.push(outcome);
    else if (outsideDomain(outcome, copy, await userDomain())) {
      const reason = `it is in domain ${copy?.head["sys_domain"]}, which the signed-in user is not in: the instance would refuse to publish it`;
      problems.push(problem(project.path, "unsafe", reason, unit.updateName));
    } else units.push(outcome);
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
  const loaded = units.filter((unit) => unit.operation !== "record");
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

export async function computeUnitPlan(
  deps: UnitPlanDependencies,
  query: UnitPlanQuery,
): Promise<{ readonly plan: UnitPushPlan; readonly loads: readonly ProjectLoad[] }> {
  const label = checkedLabel(query.label ?? (await deps.workspace.branch()));
  const loads: ProjectLoad[] = [];
  const problems: UnitProblem[] = await uncommittedSource(deps);
  const userDomain = sessionDomain(deps);
  for (const project of await deps.authoring.workspace.projects()) {
    const planned = await planProject(deps, project, query.instance, userDomain);
    if (planned.load !== null) loads.push(planned.load);
    problems.push(...planned.problems);
  }
  const units = loads.flatMap((load) => load.units);
  const base = (await deps.workspace.mirrorCommit()) ?? "HEAD";
  const gate = await gateFor(deps, base, [...new Set(units.map((u) => u.project))]);
  const collisions = await collisionsOf(deps, units, label);
  const ready =
    units.length > 0 &&
    problems.length === 0 &&
    gate.passed &&
    (collisions.length === 0 || query.allowCollisions);
  const id = unitPlanId(units, gate);
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
      ? [{ tool: "push", args: { instance: query.instance, plan: id, confirm: true } }]
      : gate.passed
        ? []
        : [{ tool: "validate", args: { base } }],
  };
  return { plan, loads };
}
