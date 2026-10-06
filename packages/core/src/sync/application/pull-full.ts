import { Catalog } from "../../metadata/domain/catalog";
import { classesToPull } from "../domain/pull-scope";
import type { SyncState, SyncStateStore } from "../ports";
import { fetchCatalog } from "./fetch-catalog";
import { fetchFingerprints } from "./fetch-fingerprints";
import { pullChildren } from "./pull-children";
import { type PullDependencies, type PullProgress, rawTimestamp } from "./pull-dependencies";
import { inventorySignatures, pullOperational } from "./pull-operational";
import { pullRecords } from "./pull-records";

export interface PullSummary {
  readonly classes: number;
  readonly resumedClasses: number;
  readonly records: number;
  readonly skippedRows: number;
  readonly childRows: number;
  readonly orphanChildRows: number;
  readonly operationalRows: number;
  // Classes and tables the integration user may not read.
  readonly unreadable: readonly string[];
  readonly watermark: string;
  // The sync state to store once the mirror commit is durable (see completePull).
  readonly next: SyncState;
  // Wall-clock seconds per phase, to see where time goes.
  readonly phaseSeconds: {
    readonly catalog: number;
    readonly records: number;
    readonly children: number;
    readonly operational: number;
  };
}

// The first, complete pull of an instance (ADR-0016, ADR-0017). Interrupted pulls resume
// from their checkpoint; the watermark is the pull's start, so changes made while it ran
// are picked up by the next incremental pull. The caller commits the mirror, then calls
// completePull: until then the checkpoint stands and a new run resumes.
export async function pullFull(
  deps: PullDependencies,
  signal: AbortSignal,
  progress: (event: PullProgress) => void = () => {},
): Promise<PullSummary> {
  const clock = phaseClock(deps.now);
  const data = await fetchCatalog(deps.pager, signal, progress);
  const catalogSeconds = clock.lap();
  await deps.state.writeCatalog(data);
  const catalog = new Catalog(data);
  const checkpoint = (await deps.state.readCheckpoint()) ?? {
    startedAt: rawTimestamp(deps.now()),
    completedClasses: [],
    records: 0,
    fingerprints: (await fetchFingerprints(deps.statistics, signal)).fingerprints,
    inventory: await inventorySignatures(deps.statistics, signal),
  };
  await deps.state.writeCheckpoint(checkpoint);
  const classes = classesToPull(catalog);
  const records = await pullRecords(deps, catalog, classes, checkpoint, signal, progress);
  const recordsSeconds = clock.lap();
  progress({ message: "child rows" });
  const children = await pullChildren(deps, catalog, signal);
  const childrenSeconds = clock.lap();
  progress({ message: "operational inventory" });
  const operational = await pullOperational(deps, signal);
  const operationalSeconds = clock.lap();
  return {
    next: {
      watermark: checkpoint.startedAt,
      lastFullPull: checkpoint.startedAt,
      fingerprints: checkpoint.fingerprints ?? {},
      inventory: checkpoint.inventory ?? {},
      unreadable: [...records.unreadable, ...children.unreadable, ...operational.unreadable],
    },
    classes: classes.length,
    resumedClasses: checkpoint.completedClasses.length,
    records: records.records,
    skippedRows: records.skippedRows,
    childRows: children.childRows,
    orphanChildRows: children.orphanChildRows,
    operationalRows: operational.operationalRows,
    unreadable: [...records.unreadable, ...children.unreadable, ...operational.unreadable],
    watermark: checkpoint.startedAt,
    phaseSeconds: {
      catalog: catalogSeconds,
      records: recordsSeconds,
      children: childrenSeconds,
      operational: operationalSeconds,
    },
  };
}

// Seconds since the previous lap, to one decimal.
function phaseClock(now: () => Date): { lap(): number } {
  let last = now().getTime();
  return {
    lap() {
      const current = now().getTime();
      const seconds = Math.round((current - last) / 100) / 10;
      last = current;
      return seconds;
    },
  };
}

// Stores the state a pull reached, once its mirror commit is durable.
export async function completePull(state: SyncStateStore, next: SyncState): Promise<void> {
  await state.writeState(next);
  await state.clearCheckpoint();
}
