import { SnagenticError } from "../../kernel/errors";
import { Catalog } from "../../metadata/domain/catalog";
import {
  changesSince,
  compareFingerprint,
  FINGERPRINT_SOURCES,
  type FingerprintChange,
} from "../domain/fingerprint";
import { unexplainedLoss } from "../domain/record-changes";
import type { Fingerprints, SyncState } from "../ports";
import { applyWithCatalog } from "./apply-with-catalog";
import { fetchFingerprints } from "./fetch-fingerprints";
import { applyChildChanges, type ChildOutcome } from "./incremental-children";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { type ChangeWindow, type RecordOutcome, readRecordChanges } from "./incremental-records";
import { type PullProgress, rawTimestamp } from "./pull-dependencies";
import {
  type RecordVerification,
  type VerifiedRecords,
  verifyAndRepairRecords,
} from "./verify-records";

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
  // pull --verify only: what the count comparison found and repaired.
  readonly verification: (RecordVerification & { recovered: number; removed: number }) | null;
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
  return { ...(await applyWithCatalog(deps, catalog, changes, signal, progress)), lostRecords };
}

export interface PullOptions {
  // Also compare the mirror with the instance by counts and repair what differs.
  readonly verify?: boolean;
}

// Every direct child table is reconciled by grouped counts, as if it had lost rows.
function verifyAllChildren(
  changes: ReadonlyMap<string, FingerprintChange>,
): Map<string, FingerprintChange> {
  return new Map(
    [...changes].map(([table, change]) => [table, table === "sys_metadata" ? change : "shrunk"]),
  );
}

async function recordStep(
  deps: IncrementalDependencies,
  state: SyncState,
  catalog: Catalog,
  current: Fingerprints,
  change: FingerprintChange,
  window: ChangeWindow,
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
): Promise<RecordStep> {
  if (change === "unchanged") {
    return { catalog, catalogRefreshed: false, lostRecords: 0, records: NO_RECORD_CHANGES };
  }
  const counts = {
    before: state.fingerprints?.["sys_metadata"]?.count,
    after: current["sys_metadata"]?.count,
  };
  return pullRecordChanges(deps, catalog, window, counts, signal, progress);
}

function summarize(
  changes: ReadonlyMap<string, FingerprintChange>,
  step: RecordStep,
  verified: VerifiedRecords | null,
  children: ChildOutcome,
  unreadable: readonly string[],
): Omit<IncrementalSummary, "watermark" | "next"> {
  const { records } = step;
  return {
    changedSources: [...changes].filter(([, change]) => change !== "unchanged").map(([t]) => t),
    catalogRefreshed: step.catalogRefreshed || (verified?.catalogRefreshed ?? false),
    records: records.written,
    renamed: records.renamed,
    deleted: records.deleted,
    skippedRows: records.skippedRows,
    childFiles: children.childFiles,
    removedChildFiles: children.removedChildFiles,
    lostRecords: step.lostRecords,
    verification:
      verified === null
        ? null
        : {
            ...verified.verification,
            recovered: verified.records.written + verified.records.renamed,
            removed: verified.records.deleted,
          },
    unreadable: [...new Set([...unreadable, ...children.unreadable])].sort(),
  };
}

// Brings the mirror up to date with what changed since the last pull (ADR-0016, M4
// appendix): one aggregate request per change source, then change feeds and targeted
// downloads only where a fingerprint moved. With verify, it then reconciles by counts.
export async function pullIncremental(
  deps: IncrementalDependencies,
  instance: string,
  signal: AbortSignal,
  progress: (event: PullProgress) => void = () => {},
  options: PullOptions = {},
): Promise<IncrementalSummary> {
  const state = await deps.state.readState();
  const stored = await deps.state.readCatalog();
  if (state === null || stored === null) {
    throw new FullPullRequiredError(instance);
  }
  const startedAt = rawTimestamp(deps.now());
  progress({ message: "checking for changes" });
  const current = await fetchFingerprints(deps.statistics, signal);
  const fingerprintChanges = compareAll(state.fingerprints, current.fingerprints);
  const changes =
    options.verify === true ? verifyAllChildren(fingerprintChanges) : fingerprintChanges;
  if (options.verify === true || [...changes.values()].some((change) => change !== "unchanged")) {
    await deps.records.prepare();
  }
  const since = changesSince(state.watermark);
  const window = { since, previous: state.watermark, current: startedAt };
  const step = await recordStep(
    deps,
    state,
    new Catalog(stored),
    current.fingerprints,
    changes.get("sys_metadata") ?? "changed",
    window,
    signal,
    progress,
  );
  const verified =
    options.verify === true
      ? await verifyAndRepairRecords(deps, step.catalog, state.unreadable ?? [], signal, progress)
      : null;
  progress({ message: "child rows" });
  const catalog = verified?.catalog ?? step.catalog;
  const children = await applyChildChanges(deps, catalog, changes, since, signal);
  const recordUnreadable = [...step.records.unreadable, ...(verified?.records.unreadable ?? [])];
  const summary = summarize(fingerprintChanges, step, verified, children, [
    ...current.unreadable,
    ...recordUnreadable,
  ]);
  return {
    ...summary,
    watermark: startedAt,
    next: {
      ...state,
      watermark: startedAt,
      fingerprints: current.fingerprints,
      unreadable: [...new Set([...(state.unreadable ?? []), ...recordUnreadable])].sort(),
    },
  };
}
