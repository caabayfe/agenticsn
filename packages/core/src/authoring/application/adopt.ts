import type { InstanceReader } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import {
  AdoptRecordsNotFoundError,
  AdoptStoreApplicationError,
  AdoptTransformFailedError,
  AdoptUnexplainedDifferenceError,
} from "../domain/adopt-errors";
import { compareUnit } from "../domain/compare";
import { unitDigest } from "../domain/digest";
import { type LedgerEntry, withEntries } from "../domain/ledger";
import { knownLoss, type LossId } from "../domain/losses";
import type { BuiltUnit, InstanceCopy } from "../domain/unit";
import { unitSpec } from "../domain/unit-specs";
import type {
  AuthoringWorkspace,
  FluentToolchain,
  SdkAccess,
  SourceDraft,
  SourceProject,
  TransformTarget,
} from "../ports";
import { readUnits } from "./read-units";

// Brings records from a development instance into the workspace's Fluent source (ADR-0031
// item 3): the SDK converts them, the build is compared with the instance, and only when the
// difference is nothing or the SDK's known losses are the source and the ledger written.

export interface AdoptDependencies {
  readonly reader: InstanceReader;
  readonly workspace: AuthoringWorkspace;
  readonly toolchain: FluentToolchain;
  readonly access: SdkAccess;
  readonly signal: AbortSignal;
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
}

interface Located {
  readonly target: TransformTarget;
  readonly scope: { readonly name: string; readonly sysId: string };
}

async function rows(
  pager: KeysetPager,
  table: string,
  ids: readonly string[],
  fields: string[],
  signal: AbortSignal,
) {
  const found: Row[] = [];
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse(table),
    base: `sys_idIN${ids.join(",")}`,
    fields,
  };
  for await (const row of pager.rows(listing, signal)) found.push(row);
  return found;
}

// Each record's class and application, as the instance holds them now.
async function locate(
  reader: InstanceReader,
  targets: readonly TransformTarget[],
  signal: AbortSignal,
): Promise<Located[]> {
  const pager = new KeysetPager(reader);
  const ids = targets.map((t) => t.sysId);
  const records = await rows(
    pager,
    "sys_metadata",
    ids,
    ["sys_id", "sys_class_name", "sys_scope"],
    signal,
  );
  const missing = targets.filter((t) => !records.some((r) => r["sys_id"] === t.sysId));
  if (missing.length > 0)
    throw new AdoptRecordsNotFoundError(missing.map((t) => `${t.table}:${t.sysId}`));
  const scopeIds = [...new Set(records.map((r) => r["sys_scope"] ?? "global"))];
  const scopes = await rows(
    pager,
    "sys_scope",
    scopeIds,
    ["sys_id", "scope", "sys_class_name"],
    signal,
  );
  const store = scopes.find((s) => s["sys_class_name"] === "sys_store_app");
  if (store !== undefined) throw new AdoptStoreApplicationError(store["scope"] ?? "");
  return records.map((record) => {
    const scopeId = record["sys_scope"] ?? "global";
    const scope = scopes.find((s) => s["sys_id"] === scopeId);
    return {
      target: { table: record["sys_class_name"] ?? "", sysId: record["sys_id"] ?? "" },
      scope: { name: scope?.["scope"] ?? "global", sysId: scopeId },
    };
  });
}

// Units the transform added or changed.
function adoptedUnits(draft: SourceDraft): BuiltUnit[] {
  const before = new Map(draft.before.map((unit) => [unit.updateName, unitDigest(unit)]));
  return draft.after.filter((unit) => before.get(unit.updateName) !== unitDigest(unit));
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
  const differences = unitSpec(unit.head.table).comparable ? compareUnit(unit, copy) : [];
  const losses = new Set<LossId>();
  for (const difference of differences) {
    const loss = knownLoss(difference);
    if (loss !== null) losses.add(loss);
    else if (difference.kind === "field")
      problems.push(describe(unit, `${difference.table}.${difference.field}`));
    else problems.push(describe(unit, `the rows of ${difference.table}`));
  }
  return { build: unitDigest(unit), instance: copy.version, losses: [...losses].sort() };
}

async function adoptInto(
  dependencies: AdoptDependencies,
  project: SourceProject,
  targets: readonly TransformTarget[],
  instance: string,
): Promise<{ units: AdoptedUnit[]; files: string[] }> {
  const { toolchain, access, reader, workspace, signal } = dependencies;
  const outcome = await toolchain.draftTransform(project, targets, access);
  if (!outcome.ok) throw new AdoptTransformFailedError(project.scope, outcome.message);
  const units = adoptedUnits(outcome.draft);
  const copies = await readUnits(reader, units, signal);
  const problems: string[] = [];
  const entries = new Map<string, LedgerEntry>();
  for (const unit of units) {
    const entry = entryFor(unit, copies.get(unit.updateName) ?? null, problems);
    if (entry !== null) entries.set(unit.updateName, entry);
  }
  if (problems.length > 0) throw new AdoptUnexplainedDifferenceError(problems);
  await outcome.draft.apply();
  await workspace.writeLedger(
    project,
    withEntries(await workspace.readLedger(project), instance, entries),
  );
  return {
    units: units.map((unit) => ({
      project: project.path,
      updateName: unit.updateName,
      table: unit.head.table,
      losses: entries.get(unit.updateName)?.losses ?? [],
    })),
    files: outcome.draft.changed.map((file) => `${project.path}/${file}`),
  };
}

export async function adopt(
  dependencies: AdoptDependencies,
  input: { readonly instance: string; readonly records: readonly TransformTarget[] },
): Promise<AdoptResult> {
  const located = await locate(dependencies.reader, input.records, dependencies.signal);
  const byScope = Map.groupBy(located, (record) => record.scope.name);
  const projects: { path: string; created: boolean }[] = [];
  const units: AdoptedUnit[] = [];
  const files: string[] = [];
  for (const [name, group] of [...byScope].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const existing = await dependencies.workspace.project(name);
    const scope = group[0]?.scope ?? { name, sysId: name };
    const project = existing ?? (await dependencies.workspace.scaffold(scope));
    projects.push({ path: project.path, created: existing === null });
    const adopted = await adoptInto(
      dependencies,
      project,
      group.map((r) => r.target),
      input.instance,
    );
    units.push(...adopted.units);
    files.push(...adopted.files);
  }
  return { projects, units, files };
}
