import type { Catalog } from "../../metadata/domain/catalog";
import type { SecretRedaction } from "../../metadata/domain/secret-scan";
import type { FingerprintChange } from "../domain/fingerprint";
import { unexplainedLoss } from "../domain/record-changes";
import type { Fingerprints, SyncState } from "../ports";
import { applyWithCatalog } from "./apply-with-catalog";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { type ChangeWindow, type RecordOutcome, readRecordChanges } from "./incremental-records";
import type { PullProgress } from "./pull-dependencies";
import { rereadForRedaction } from "./redaction-reread";
import { verifyAndRepairRecords } from "./verify-records";

// The record part of an incremental pull (ADR-0016): feeds, redaction re-read, verification.

const NO_RECORD_CHANGES: RecordOutcome = {
  created: [],
  written: 0,
  renamed: 0,
  deleted: 0,
  skippedRows: 0,
  malformedValues: 0,
  unreadable: [],
  unwritten: [],
  secretRedactions: [],
};

export interface RecordStep {
  readonly catalog: Catalog;
  readonly catalogRefreshed: boolean;
  readonly catalogSecretRedactions: readonly SecretRedaction[];
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
    return {
      catalog,
      catalogRefreshed: false,
      catalogSecretRedactions: [],
      lostRecords: 0,
      records: NO_RECORD_CHANGES,
    };
  }
  const counts = {
    before: state.fingerprints?.["sys_metadata"]?.count,
    after: current["sys_metadata"]?.count,
  };
  return pullRecordChanges(deps, catalog, window, counts, signal, progress);
}

// Records: the feeds, then the re-read a newer redaction policy asks for, then verification.
export async function recordPhase(
  deps: IncrementalDependencies,
  run: {
    readonly state: SyncState;
    readonly catalog: Catalog;
    readonly fingerprints: Fingerprints;
    readonly change: FingerprintChange;
    readonly window: ChangeWindow;
    readonly verify: boolean;
  },
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
) {
  const { state, catalog, fingerprints, change, window, verify } = run;
  const step = await recordStep(
    deps,
    state,
    catalog,
    fingerprints,
    change,
    window,
    signal,
    progress,
  );
  const reread = await rereadForRedaction(deps, state, step.catalog, signal);
  const previous = { unreadable: state.unreadable ?? [], hidden: state.hiddenCounts ?? {} };
  const verified = verify
    ? await verifyAndRepairRecords(deps, step.catalog, previous, signal, progress)
    : null;
  const unreadable = [
    ...step.records.unreadable,
    ...(verified?.records.unreadable ?? []),
    ...reread.unreadable,
  ];
  return { step, reread, verified, unreadable };
}
