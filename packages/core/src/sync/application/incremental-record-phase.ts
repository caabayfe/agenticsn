import type { Catalog } from "../../metadata/domain/catalog";
import type { SecretRedaction } from "../../metadata/domain/secret-scan";
import type { FingerprintChange } from "../domain/fingerprint";
import { unexplainedLoss } from "../domain/record-changes";
import {
  carryUnstored,
  type ExplainedRecord,
  markInMirror,
  sortUnstored,
  type UnreturnedRecord,
  unstoredReport,
} from "../domain/unstored-records";
import type { Fingerprints, SyncState } from "../ports";
import { applyWithCatalog } from "./apply-with-catalog";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { type ChangeWindow, type RecordOutcome, readRecordChanges } from "./incremental-records";
import type { PullProgress } from "./pull-dependencies";
import { rereadForRedaction } from "./redaction-reread";
import { rereadUnstored, type UnstoredReread } from "./reread-unstored";
import { type VerifiedRecords, verifyAndRepairRecords } from "./verify-records";

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
  unreturned: [],
  returned: [],
  secretRedactions: [],
};

export interface RecordStep {
  readonly catalog: Catalog;
  readonly catalogRefreshed: boolean;
  readonly catalogSecretRedactions: readonly SecretRedaction[];
  readonly lostRecords: number;
  readonly records: RecordOutcome;
  // sys_ids the instance's deletion records name.
  readonly deleted: readonly string[];
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
  const applied = await applyWithCatalog(deps, catalog, changes, signal, progress);
  return { ...applied, lostRecords, deleted: changes.deleted };
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
      deleted: [],
    };
  }
  const counts = {
    before: state.fingerprints?.["sys_metadata"]?.count,
    after: current["sys_metadata"]?.count,
  };
  return pullRecordChanges(deps, catalog, window, counts, signal, progress);
}

// What pull --verify read again counts with what the feeds brought: the same records, late.
function withReread(step: RecordStep, retried: UnstoredReread | null): RecordStep {
  if (retried === null) return step;
  const { applied } = retried;
  return {
    ...step,
    catalog: applied.catalog,
    catalogRefreshed: step.catalogRefreshed || applied.catalogRefreshed,
    catalogSecretRedactions: [...step.catalogSecretRedactions, ...applied.catalogSecretRedactions],
    records: {
      ...step.records,
      written: step.records.written + applied.records.written,
      renamed: step.records.renamed + applied.records.renamed,
      malformedValues: step.records.malformedValues + applied.records.malformedValues,
      unreadable: [...new Set([...step.records.unreadable, ...applied.records.unreadable])].sort(),
      created: [...step.records.created, ...applied.records.created],
      secretRedactions: [...step.records.secretRedactions, ...applied.records.secretRedactions],
    },
  };
}

// What the pull reports as unstored, and what its state carries to the next pull --verify.
function unstoredOutcome(
  found: {
    readonly verify: boolean;
    readonly unreturned: readonly UnreturnedRecord[];
    readonly carried: readonly UnreturnedRecord[];
    readonly retried: UnstoredReread | null;
    readonly verified: VerifiedRecords | null;
  },
  inMirror: (sysId: string) => boolean,
) {
  if (found.verify) {
    // A record the instance no longer lists and the mirror no longer holds is settled.
    const still = markInMirror(found.retried?.still ?? [], inMirror).filter(
      (record) => record.reason !== "not-listed" || record.inMirror,
    );
    return {
      unstored: unstoredReport(still, found.retried?.recovered ?? 0),
      stillUnstored: sortUnstored(still),
    };
  }
  const own: ExplainedRecord[] = found.unreturned.map((record) => ({
    ...record,
    reason: "not-returned",
  }));
  const marked = markInMirror(own, inMirror);
  // The verification a pull runs for lost records accounts for those the mirror lacked (it
  // stores them, or counts them as not mirrorable or hidden) and removes those gone from the
  // instance: what is left is reported.
  const reported =
    found.verified === null
      ? marked
      : marked.filter((record) => record.inMirror && inMirror(record.sysId));
  return { unstored: unstoredReport(reported), stillUnstored: found.carried };
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
  const fed = await recordStep(
    deps,
    state,
    catalog,
    fingerprints,
    change,
    window,
    signal,
    progress,
  );
  const { unreturned } = fed.records;
  const carried = carryUnstored(state.unstored ?? [], {
    returned: fed.records.returned,
    deleted: fed.deleted,
    unreturned,
  });
  // Only pull --verify asks again, and only for records a pull recorded (ASR-16).
  const retried =
    verify && carried.length > 0
      ? await rereadUnstored(deps, fed.catalog, carried, signal, progress)
      : null;
  const step = withReread(fed, retried);
  const reread = await rereadForRedaction(deps, state, step.catalog, signal);
  const previous = { unreadable: state.unreadable ?? [], hidden: state.hiddenCounts ?? {} };
  const inMirror = (sysId: string) => deps.records.baseOf(deps.metadataRoot, sysId) !== undefined;
  // Records that left without a deletion record (an update-set load deletes without one, pdi2
  // 2026-10-26) are found by the counts, as pull --verify does: only on such a pull.
  const verified =
    verify || step.lostRecords > 0
      ? await verifyAndRepairRecords(deps, step.catalog, previous, signal, progress)
      : null;
  const outcome = unstoredOutcome({ verify, unreturned, carried, retried, verified }, inMirror);
  const unreadable = [
    ...step.records.unreadable,
    ...(verified?.records.unreadable ?? []),
    ...reread.unreadable,
  ];
  return { step, reread, verified, unreadable, ...outcome };
}
