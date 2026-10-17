import type { InstanceReader } from "../../connection/ports";
import type { CatalogData } from "../../metadata/domain/catalog";
import { DEFAULT_REDACTION } from "../../metadata/domain/redaction";
import {
  AdoptSecretError,
  AdoptTransformFailedError,
  AdoptUnexplainedDifferenceError,
  NothingAdoptedError,
} from "../domain/adopt-errors";
import { compareUnit, type Difference } from "../domain/compare";
import { unitDigest } from "../domain/digest";
import { type LedgerEntry, withEntries } from "../domain/ledger";
import { knownLoss, type LossId } from "../domain/losses";
import type { BuiltUnit, InstanceCopy } from "../domain/unit";
import { unitSecrets } from "../domain/unit-secrets";
import { unitSpec } from "../domain/unit-specs";
import type {
  AuthoringWorkspace,
  FluentToolchain,
  SdkAccess,
  SourceDraft,
  SourceProject,
  TransformTarget,
} from "../ports";
import { locate } from "./locate-records";
import { readUnits } from "./read-units";
import { unitCatalog } from "./unit-catalog";

// Brings records from a development instance into the workspace's Fluent source (ADR-0031
// item 3): the SDK converts them, the build is compared with the instance, and only when the
// difference is nothing or the SDK's known losses are the source and the ledger written.

export interface AdoptDependencies {
  readonly reader: InstanceReader;
  readonly workspace: AuthoringWorkspace;
  readonly toolchain: FluentToolchain;
  readonly access: SdkAccess;
  readonly signal: AbortSignal;
  // The instance's catalog as last pulled, to know which fields hold secrets; read from the
  // dictionary for the adopted tables when the workspace has none.
  readonly catalog?: CatalogData | null;
}

export interface AdoptedUnit {
  readonly project: string;
  readonly updateName: string;
  readonly table: string;
  readonly losses: readonly LossId[];
}

export interface AdoptResult {
  readonly projects: readonly { readonly path: string; readonly created: boolean }[];
  readonly units: readonly AdoptedUnit[];
  readonly files: readonly string[];
  // Records asked for that the SDK expresses with no unit of their class (table licensing
  // configs, S16): they stay on the instance, unmanaged by source.
  readonly unmanaged: readonly string[];
  // Files a refresh left with conflict markers: resolve them as any git conflict.
  readonly conflicts: readonly string[];
}

// Units the transform added or changed.
function adoptedUnits(draft: SourceDraft): BuiltUnit[] {
  const before = new Map(draft.before.map((unit) => [unit.updateName, unitDigest(unit)]));
  return draft.after.filter((unit) => before.get(unit.updateName) !== unitDigest(unit));
}

const shown = (value: string) =>
  JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);

function explain(difference: Difference): string {
  return difference.kind === "field"
    ? `${difference.table}.${difference.field} would be ${shown(difference.built)}, is ${shown(difference.instance)}`
    : `${difference.table} rows would be [${difference.built.join(", ")}], are [${difference.instance.join(", ")}]`;
}

function describe(unit: BuiltUnit, detail: string) {
  return `${unit.updateName}: ${detail}`;
}

// Checks each unit against the instance: its ledger entry, or why it cannot be adopted.
function entryFor(
  unit: BuiltUnit,
  copy: InstanceCopy | null,
  problems: string[],
): LedgerEntry | null {
  if (copy === null) {
    problems.push(describe(unit, "the build makes a record the instance does not hold"));
    return null;
  }
  if (copy.foreignRows > 0) {
    // The SDK writes a composite's rows in one domain (S16); here they live in another.
    problems.push(
      describe(unit, `${copy.foreignRows} of its rows are in a domain the SDK would not keep`),
    );
    return null;
  }
  const differences = unitSpec(unit.head.table).comparable ? compareUnit(unit, copy) : [];
  const losses = new Set<LossId>();
  for (const difference of differences) {
    const loss = knownLoss(difference);
    if (loss !== null) losses.add(loss);
    else problems.push(describe(unit, explain(difference)));
  }
  return { build: unitDigest(unit), instance: copy.version, losses: [...losses].sort() };
}

interface Adoption {
  readonly units: AdoptedUnit[];
  readonly files: string[];
  readonly unmanaged: string[];
  readonly conflicts: string[];
}

// The ledger entries of the units a draft adds or changes, refusing any it cannot explain.
async function checkedEntries(dependencies: AdoptDependencies, units: readonly BuiltUnit[]) {
  const copies = await readUnits(dependencies.reader, units, dependencies.signal);
  const problems: string[] = [];
  const entries = new Map<string, LedgerEntry>();
  for (const unit of units) {
    const entry = entryFor(unit, copies.get(unit.updateName) ?? null, problems);
    if (entry !== null) entries.set(unit.updateName, entry);
  }
  if (problems.length > 0) throw new AdoptUnexplainedDifferenceError(problems);
  return entries;
}

// Adopts into the working tree; refreshing converts as of the commit that last wrote the
// ledger, then merges into the working tree, so local work is kept as git keeps it (S16 F4).
async function adoptInto(
  dependencies: AdoptDependencies,
  project: SourceProject,
  targets: readonly TransformTarget[],
  input: AdoptInput,
): Promise<Adoption> {
  const { toolchain, access, workspace } = dependencies;
  const base = input.refresh === true ? await workspace.ledgerCommit(project) : null;
  if (input.refresh === true && base === null) throw new NothingAdoptedError(project.path);
  const outcome = await toolchain.draftTransform(project, targets, access, base ?? undefined);
  if (!outcome.ok) throw new AdoptTransformFailedError(project.scope, outcome.message);
  const units = adoptedUnits(outcome.draft);
  const catalog = await unitCatalog(dependencies, units);
  const secrets = unitSecrets(units, catalog, DEFAULT_REDACTION);
  if (secrets.length > 0) throw new AdoptSecretError(secrets);
  const entries = await checkedEntries(dependencies, units);
  let conflicts: readonly string[] = [];
  if (base === null) await workspace.writeFiles(project, outcome.draft.files);
  else conflicts = await workspace.mergeFiles(project, base, outcome.draft.files);
  const ledger = withEntries(await workspace.readLedger(project), input.instance, entries);
  await workspace.writeLedger(project, ledger);
  const inProject = (file: string) => `${project.path}/${file}`;
  return {
    units: units.map((unit) => ({
      project: project.path,
      updateName: unit.updateName,
      table: unit.head.table,
      losses: entries.get(unit.updateName)?.losses ?? [],
    })),
    files: [...outcome.draft.files.keys()].map(inProject),
    unmanaged: unexpressed(targets, outcome.draft.after),
    conflicts: conflicts.map(inProject),
  };
}

function unexpressed(targets: readonly TransformTarget[], units: readonly BuiltUnit[]): string[] {
  const tables = new Set(
    units.flatMap((unit) => [unit.head.table, ...unit.children.map((c) => c.table)]),
  );
  return targets.filter((t) => !tables.has(t.table)).map((t) => `${t.table}:${t.sysId}`);
}

export interface AdoptInput {
  readonly instance: string;
  readonly records: readonly TransformTarget[];
  // Re-read records already adopted, after someone changed them on the instance.
  readonly refresh?: boolean;
}

export async function adopt(
  dependencies: AdoptDependencies,
  input: AdoptInput,
): Promise<AdoptResult> {
  const located = await locate(dependencies.reader, input.records, dependencies.signal);
  const byScope = Map.groupBy(located, (record) => record.scope.name);
  const projects: { path: string; created: boolean }[] = [];
  const results: Adoption[] = [];
  for (const [name, group] of [...byScope].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const existing = await dependencies.workspace.project(name);
    const scope = group[0]?.scope ?? { name, sysId: name };
    if (existing === null && input.refresh === true)
      throw new NothingAdoptedError(`source/${name}`);
    const project = existing ?? (await dependencies.workspace.scaffold(scope));
    projects.push({ path: project.path, created: existing === null });
    results.push(
      await adoptInto(
        dependencies,
        project,
        group.map((r) => r.target),
        input,
      ),
    );
  }
  return {
    projects,
    units: results.flatMap((r) => r.units),
    files: results.flatMap((r) => r.files),
    unmanaged: results.flatMap((r) => r.unmanaged),
    conflicts: results.flatMap((r) => r.conflicts),
  };
}
