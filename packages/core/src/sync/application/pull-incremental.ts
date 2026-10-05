import { SnagenticError } from "../../kernel/errors";
import { Catalog } from "../../metadata/domain/catalog";
import {
  changesSince,
  compareFingerprint,
  FINGERPRINT_SOURCES,
  type FingerprintChange,
} from "../domain/fingerprint";
import { needsNewCatalog } from "../domain/record-changes";
import type { SyncState } from "../ports";
import { fetchCatalog } from "./fetch-catalog";
import { fetchFingerprints } from "./fetch-fingerprints";
import { applyChildChanges } from "./incremental-children";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { applyRecordChanges, readRecordChanges } from "./incremental-records";
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
  readonly unreadable: readonly string[];
  readonly watermark: string;
  // The sync state to store once the mirror commit is durable (see completePull).
  readonly next: SyncState;
}

const NO_RECORD_CHANGES = { written: 0, renamed: 0, deleted: 0, skippedRows: 0, unreadable: [] };

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
  const changes = new Map<string, FingerprintChange>(
    FINGERPRINT_SOURCES.map((table) => {
      const now = current.fingerprints[table];
      const previous = state.fingerprints?.[table];
      return [table, now === undefined ? "changed" : compareFingerprint(previous, now)];
    }),
  );
  const since = changesSince(state.watermark);
  if ([...changes.values()].some((change) => change !== "unchanged")) {
    await deps.records.prepare();
  }
  let catalog = new Catalog(stored);
  let catalogRefreshed = false;
  let records = NO_RECORD_CHANGES as Awaited<ReturnType<typeof applyRecordChanges>>;
  if (changes.get("sys_metadata") !== "unchanged") {
    progress({ message: "records" });
    const recordChanges = await readRecordChanges(deps, since, signal);
    if (needsNewCatalog(recordChanges, catalog)) {
      const data = await fetchCatalog(deps.pager, signal, progress);
      await deps.state.writeCatalog(data);
      catalog = new Catalog(data);
      catalogRefreshed = true;
    }
    records = await applyRecordChanges(deps, catalog, recordChanges, signal);
  }
  progress({ message: "child rows" });
  const children = await applyChildChanges(deps, catalog, changes, since, signal);
  return {
    changedSources: [...changes].filter(([, change]) => change !== "unchanged").map(([t]) => t),
    catalogRefreshed,
    records: records.written,
    renamed: records.renamed,
    deleted: records.deleted,
    skippedRows: records.skippedRows,
    childFiles: children.childFiles,
    removedChildFiles: children.removedChildFiles,
    unreadable: [
      ...new Set([...current.unreadable, ...records.unreadable, ...children.unreadable]),
    ].sort(),
    watermark: startedAt,
    next: { ...state, watermark: startedAt, fingerprints: current.fingerprints },
  };
}
