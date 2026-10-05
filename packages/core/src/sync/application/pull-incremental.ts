import { SnagenticError } from "../../kernel/errors";
import { Catalog } from "../../metadata/domain/catalog";
import {
  changesSince,
  compareFingerprint,
  FINGERPRINT_SOURCES,
  type FingerprintChange,
} from "../domain/fingerprint";
import { needsNewCatalog, unexplainedLoss } from "../domain/record-changes";
import type { Fingerprints, SyncState } from "../ports";
import { fetchCatalog } from "./fetch-catalog";
import { fetchFingerprints } from "./fetch-fingerprints";
import { applyChildChanges } from "./incremental-children";
import type { IncrementalDependencies } from "./incremental-dependencies";
import {
  applyRecordChanges,
  type ChangeWindow,
  type RecordOutcome,
  readRecordChanges,
} from "./incremental-records";
import { type PullProgress, rawTimestamp } from "./pull-dependencies";

export class FullPullRequiredError extends SnagenticError {
  constructor(instance: string) {
    super(
      "full-pull-required",
      "precondition",
      `${instance} has no complete pull to continue from`,
      `run: snagentic pull ${instance} --full`,
    );
  }
}

export interface IncrementalSummary {
  // Change sources whose fingerprint moved; empty when the instance had nothing new.
  readonly changedSources: readonly string[];
  readonly catalogRefreshed: boolean;
  readonly records: number;
  readonly renamed: number;
  readonly deleted: number;
  readonly skippedRows: number;
  readonly childFiles: number;
  readonly removedChildFiles: number;
  // Records gone from the instance without a deletion record; still in the mirror.
  readonly lostRecords: number;
  readonly unreadable: readonly string[];
  readonly watermark: string;
  // The sync state to store once the mirror commit is durable (see completePull).
  readonly next: SyncState;
}

const NO_RECORD_CHANGES: RecordOutcome = {
  written: 0,
  renamed: 0,
  deleted: 0,
  skippedRows: 0,
  unreadable: [],
};

function compareAll(previous: Fingerprints | undefined, current: Fingerprints) {
  return new Map<string, FingerprintChange>(
    FINGERPRINT_SOURCES.map((table) => {
      const now = current[table];
      return [table, now === undefined ? "changed" : compareFingerprint(previous?.[table], now)];
    }),
  );
}

interface RecordStep {
  readonly catalog: Catalog;
  readonly catalogRefreshed: boolean;
  readonly lostRecords: number;
  readonly records: RecordOutcome;
}

// Reads the record feeds, refreshes the catalog when they show it is stale, and applies them.
async function pullRecordChanges(
  deps: IncrementalDependencies,
  catalog: Catalog,
  window: ChangeWindow,
  counts: { before: number | undefined; after: number | undefined },
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
): Promise<RecordStep> {
  progress({ message: "records" });
  const changes = await readRecordChanges(deps, window, signal);
  const lostRecords =
    counts.before === undefined || counts.after === undefined
      ? 0
      : unexplainedLoss(counts.before, counts.after, changes);
  let current = catalog;
  const catalogRefreshed = needsNewCatalog(changes, catalog);
  if (catalogRefreshed) {
    const data = await fetchCatalog(deps.pager, signal, progress);
    await deps.state.writeCatalog(data);
    current = new Catalog(data);
  }
  const records = await applyRecordChanges(deps, current, changes, signal);
  return { catalog: current, catalogRefreshed, lostRecords, records };
}

// Brings the mirror up to date with what changed since the last pull (ADR-0016, M4
// appendix): one aggregate request per change source, then change feeds and targeted
// downloads only where a fingerprint moved.
export async function pullIncremental(
  deps: IncrementalDependencies,
  instance: string,
  signal: AbortSignal,
  progress: (event: PullProgress) => void = () => {},
): Promise<IncrementalSummary> {
  const state = await deps.state.readState();
  const stored = await deps.state.readCatalog();
  if (state === null || stored === null) {
    throw new FullPullRequiredError(instance);
  }
  const startedAt = rawTimestamp(deps.now());
  progress({ message: "checking for changes" });
  const current = await fetchFingerprints(deps.statistics, signal);
  const changes = compareAll(state.fingerprints, current.fingerprints);
  if ([...changes.values()].some((change) => change !== "unchanged")) {
    await deps.records.prepare();
  }
  const since = changesSince(state.watermark);
  const step: RecordStep =
    changes.get("sys_metadata") === "unchanged"
      ? {
          catalog: new Catalog(stored),
          catalogRefreshed: false,
          lostRecords: 0,
          records: NO_RECORD_CHANGES,
        }
      : await pullRecordChanges(
          deps,
          new Catalog(stored),
          { since, previous: state.watermark, current: startedAt },
          {
            before: state.fingerprints?.["sys_metadata"]?.count,
            after: current.fingerprints["sys_metadata"]?.count,
          },
          signal,
          progress,
        );
  progress({ message: "child rows" });
  const children = await applyChildChanges(deps, step.catalog, changes, since, signal);
  const { records } = step;
  return {
    changedSources: [...changes].filter(([, change]) => change !== "unchanged").map(([t]) => t),
    catalogRefreshed: step.catalogRefreshed,
    records: records.written,
    renamed: records.renamed,
    deleted: records.deleted,
    skippedRows: records.skippedRows,
    childFiles: children.childFiles,
    removedChildFiles: children.removedChildFiles,
    lostRecords: step.lostRecords,
    unreadable: [
      ...new Set([...current.unreadable, ...records.unreadable, ...children.unreadable]),
    ].sort(),
    watermark: startedAt,
    next: { ...state, watermark: startedAt, fingerprints: current.fingerprints },
  };
}
