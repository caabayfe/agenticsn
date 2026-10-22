import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import { TakeOverBuildFailedError } from "../domain/adopt-errors";
import { type LedgerEntry, withEntries } from "../domain/ledger";
import type { BuiltUnit, InstanceCopy } from "../domain/unit";
import type { AuthoringWorkspace, FluentToolchain, SourceProject, TransformTarget } from "../ports";
import { readUnits } from "./read-units";

// Takes over out-of-box records a module declares whole in its source, such as a form layout
// (ADR-0038 item 8): a record still as the platform shipped it (no customer update under its
// update name) is recorded in the ledger as this branch's, so the next plan loads the module's
// version over it. A record the client customized is refused and nothing is written: merging
// is the admin's decision, never the install's.

export interface TakeOverDependencies {
  readonly reader: InstanceReader;
  readonly workspace: AuthoringWorkspace;
  readonly toolchain: FluentToolchain;
  readonly signal: AbortSignal;
}

export interface TakeOverInput {
  readonly instance: string;
  readonly records: readonly TransformTarget[];
}

export interface TakenRecord extends TransformTarget {
  readonly updateName: string;
  // The project whose ledger now holds it (empty for a refused record).
  readonly project: string;
}

export interface TakeOverResult {
  // Recorded as this branch's: the unit's update name is the build's.
  readonly taken: readonly TakenRecord[];
  // Already this branch's (the ledger holds the unit that makes them).
  readonly owned: readonly string[];
  // Customized on the instance: the update name is the instance record's.
  readonly customized: readonly TakenRecord[];
  // No unit of any project's build matches them on the instance.
  readonly absent: readonly TransformTarget[];
}

const key = (target: TransformTarget) => `${target.table}:${target.sysId}`;

// Update names that have at least one customer update recorded on the instance.
async function customized(
  reader: InstanceReader,
  names: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  if (names.length === 0) return found;
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse("sys_update_xml"),
    base: `nameIN${names.join(",")}`,
    fields: ["sys_id", "name"],
  };
  for await (const row of new KeysetPager(reader).rows(listing, signal)) {
    found.add(row["name"] ?? "");
  }
  return found;
}

interface Match {
  readonly project: SourceProject;
  readonly unit: BuiltUnit;
  readonly copy: InstanceCopy;
  readonly target: TransformTarget;
  readonly owned: boolean;
}

// Each project's units that are, on the instance, one of the records asked for.
async function matches(
  deps: TakeOverDependencies,
  instance: string,
  wanted: ReadonlyMap<string, TransformTarget>,
): Promise<Match[]> {
  const tables = new Set([...wanted.values()].map((t) => t.table));
  const found: Match[] = [];
  for (const project of await deps.workspace.projects()) {
    const build = await deps.toolchain.build(project);
    if (!build.ok) throw new TakeOverBuildFailedError(project.path, build.message);
    const entries = (await deps.workspace.readLedger(project)).get(instance);
    const units = build.units.filter((unit) => tables.has(unit.head.table));
    const copies = await readUnits(deps.reader, units, deps.signal);
    for (const unit of units) {
      const copy = copies.get(unit.updateName) ?? null;
      const target =
        copy === null ? undefined : wanted.get(`${unit.head.table}:${copy.head["sys_id"]}`);
      if (copy === null || target === undefined) continue;
      found.push({ project, unit, copy, target, owned: entries?.has(unit.updateName) ?? false });
    }
  }
  return found;
}

export async function takeOver(
  deps: TakeOverDependencies,
  input: TakeOverInput,
): Promise<TakeOverResult> {
  const wanted = new Map(input.records.map((target) => [key(target), target]));
  const found = await matches(deps, input.instance, wanted);
  const open = found.filter((m) => !m.owned);
  const nameOf = (m: Match) => m.copy.head["sys_update_name"] ?? "";
  const changed = await customized(deps.reader, open.map(nameOf).filter(Boolean), deps.signal);
  const taken = open.filter((m) => !changed.has(nameOf(m)));
  for (const [project, group] of Map.groupBy(taken, (m) => m.project)) {
    const entries = new Map<string, LedgerEntry>(
      group.map((m) => [m.unit.updateName, { build: "", instance: m.copy.version, losses: [] }]),
    );
    const ledger = await deps.workspace.readLedger(project);
    await deps.workspace.writeLedger(project, withEntries(ledger, input.instance, entries));
  }
  const matched = new Set(found.map((m) => key(m.target)));
  return {
    taken: taken.map((m) => ({
      ...m.target,
      updateName: m.unit.updateName,
      project: m.project.path,
    })),
    owned: found.filter((m) => m.owned).map((m) => m.unit.updateName),
    customized: open
      .filter((m) => changed.has(nameOf(m)))
      .map((m) => ({ ...m.target, updateName: nameOf(m), project: "" })),
    absent: input.records.filter((target) => !matched.has(key(target))),
  };
}
