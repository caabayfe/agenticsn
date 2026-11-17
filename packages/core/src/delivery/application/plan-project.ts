import {
  type AuthoringWorkspace,
  type BuiltUnit,
  type FluentToolchain,
  isDeletion,
  type Ledger,
  type LedgerEntry,
  pendingFor,
  readUnits,
  type SourceProject,
  unitDigest,
} from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import type { PlannedUnit, UnitProblem } from "../domain/unit-plan";
import type { CaptureDecoder, PendingDelivery } from "../ports";
import { planCandidate } from "./plan-candidate";
import { removedDefinitions } from "./removed-definitions";

interface ProjectDependencies {
  readonly authoring: {
    readonly workspace: AuthoringWorkspace;
    readonly toolchain: FluentToolchain;
  };
  readonly reader: InstanceReader;
  readonly recheckUnits?: readonly string[];
  readonly decodeCapture?: CaptureDecoder;
  readonly signal: AbortSignal;
}

// One project's share of a plan: what push loads, and what it reads back.
export interface ProjectLoad {
  readonly project: SourceProject;
  readonly ledger: Ledger;
  readonly units: readonly PlannedUnit[];
  // Built units and their XML, by update name, for the units planned.
  readonly built: ReadonlyMap<string, { readonly unit: BuiltUnit; readonly xml: string }>;
}

const problem = (project: string, kind: UnitProblem["kind"], reason: string) => ({
  project,
  updateName: "",
  kind,
  reason,
});

function candidatesOf(
  units: readonly BuiltUnit[],
  digests: ReadonlyMap<string, string>,
  entries: ReadonlyMap<string, LedgerEntry>,
  pending: readonly PendingDelivery[],
  recoverPending: boolean,
  recheck: ReadonlySet<string>,
) {
  return units.filter((unit) => {
    const digest = digests.get(unit.updateName) ?? "";
    const receipt = pendingFor(pending, unit, digest);
    return recoverPending
      ? receipt !== undefined
      : isDeletion(unit) ||
          recheck.has(unit.updateName) ||
          entries.get(unit.updateName)?.build !== digest ||
          receipt !== undefined;
  });
}

function deletionNames(units: readonly BuiltUnit[], copies: Awaited<ReturnType<typeof readUnits>>) {
  return new Map(
    units
      .filter(isDeletion)
      .map((unit) => [
        unit.updateName,
        copies.get(unit.updateName)?.head["sys_update_name"] ?? null,
      ]),
  );
}

export async function planProject(
  deps: ProjectDependencies,
  project: SourceProject,
  instance: string,
  userDomain: () => Promise<string>,
  pending: readonly PendingDelivery[],
  recoverPending: boolean,
): Promise<{ load: ProjectLoad | null; problems: UnitProblem[] }> {
  const build = await deps.authoring.toolchain.build(project);
  if (!build.ok) return { load: null, problems: [problem(project.path, "build", build.message)] };
  const ledger = await deps.authoring.workspace.readLedger(project);
  const entries = ledger.get(instance) ?? new Map<string, LedgerEntry>();
  const digests = new Map(build.units.map((unit) => [unit.updateName, unitDigest(unit)]));
  const candidates = candidatesOf(
    build.units,
    digests,
    entries,
    pending,
    recoverPending,
    new Set(deps.recheckUnits),
  );
  const copies = await readUnits(deps.reader, candidates, deps.signal);
  const deleted = deletionNames(candidates, copies);
  const removed = recoverPending
    ? { forgotten: [], problems: [] }
    : await removedDefinitions(
        deps.reader,
        deps.signal,
        project,
        entries,
        build.units,
        new Set(deleted.values()),
      );
  const units: PlannedUnit[] = [...removed.forgotten];
  const problems = removed.problems;
  const draftSchemas = new Map<string, Promise<ReadonlySet<string>>>();
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
      recoverPending,
      draftSchemas,
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
