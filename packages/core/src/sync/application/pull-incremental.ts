import { SnagenticError } from "../../kernel/errors";
import { Catalog } from "../../metadata/domain/catalog";
import { changesSince, type FingerprintChange } from "../domain/fingerprint";
import type { InventorySource } from "../domain/inventory";
import { CHILD_TABLES } from "../domain/pull-scope";
import { unexplainedLoss } from "../domain/record-changes";
import type { Fingerprints, SyncState } from "../ports";
import { applyWithCatalog } from "./apply-with-catalog";
import { detectChanges } from "./detect-changes";
import { applyChildChanges, type ChildOutcome } from "./incremental-children";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { type ChangeWindow, type RecordOutcome, readRecordChanges } from "./incremental-records";
import { pullApplications } from "./pull-applications";
import { type PullProgress, rawTimestamp } from "./pull-dependencies";
import { pullOperational } from "./pull-operational";
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
  // Inventory files listed again because their source changed (or with verify).
  readonly inventoryRefreshed: readonly string[];
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
  unwritten: [],
};

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
): Omit<IncrementalSummary, "watermark" | "next" | "inventoryRefreshed"> {
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
// An application is a sys_scope row: the inventory's sys_scope fingerprint moves with it.
async function applicationsIfMoved(
  deps: IncrementalDependencies,
  catalog: Catalog,
  stale: readonly { readonly table: string }[],
  signal: AbortSignal,
) {
  return stale.some((source) => source.table === "sys_scope")
    ? pullApplications(deps, catalog, signal, deps.records)
    : { applications: 0, unreadable: [] };
}

function nextState(
  state: SyncState,
  startedAt: string,
  fingerprints: Fingerprints,
  inventory: Readonly<Record<string, string>>,
  unreadable: readonly string[],
  verified: VerifiedRecords | null,
): SyncState {
  return {
    ...state,
    watermark: startedAt,
    fingerprints,
    // A signal not read this time keeps the signature it had.
    inventory: { ...state.inventory, ...inventory },
    unreadable: [...new Set([...(state.unreadable ?? []), ...unreadable])].sort(),
    ...(verified === null ? {} : { hiddenCounts: verified.hidden }),
  };
}

// Child rows, applications and the operational inventory: what the record feeds do not carry.
async function pullBesideRecords(
  deps: IncrementalDependencies,
  catalog: Catalog,
  moved: {
    readonly state: SyncState;
    readonly changes: ReadonlyMap<string, FingerprintChange>;
    readonly stale: readonly InventorySource[];
    readonly since: string;
  },
  signal: AbortSignal,
) {
  const { state, changes, stale, since } = moved;
  const neverRead = new Set(
    CHILD_TABLES.map((child) => child.table).filter((table) => !state.fingerprints?.[table]),
  );
  const children = await applyChildChanges(deps, catalog, changes, { since, neverRead }, signal);
  const applications = await applicationsIfMoved(deps, catalog, stale, signal);
  const operational = await pullOperational(deps, signal, stale);
  return { children, unreadable: [...applications.unreadable, ...operational.unreadable] };
}

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
  const verify = options.verify === true;
  const startedAt = rawTimestamp(deps.now());
  progress({ message: "checking for changes" });
  const { current, fingerprintChanges, changes, inventory, stale } = await detectChanges(
    deps,
    state,
    verify,
    signal,
  );
  const since = changesSince(state.watermark);
  const window = { since, previous: state.watermark, current: startedAt };
  const metadataChange = changes.get("sys_metadata") ?? "changed";
  const step = await recordStep(
    deps,
    state,
    new Catalog(stored),
    current.fingerprints,
    metadataChange,
    window,
    signal,
    progress,
  );
  const previous = { unreadable: state.unreadable ?? [], hidden: state.hiddenCounts ?? {} };
  const verified = verify
    ? await verifyAndRepairRecords(deps, step.catalog, previous, signal, progress)
    : null;
  progress({ message: "child rows" });
  const rest = await pullBesideRecords(
    deps,
    verified?.catalog ?? step.catalog,
    { state, changes, stale, since },
    signal,
  );
  const recordUnreadable = [...step.records.unreadable, ...(verified?.records.unreadable ?? [])];
  const unreadable = [...current.unreadable, ...recordUnreadable, ...rest.unreadable];
  return {
    ...summarize(fingerprintChanges, step, verified, rest.children, unreadable),
    inventoryRefreshed: stale.map((source) => source.file),
    watermark: startedAt,
    next: nextState(state, startedAt, current.fingerprints, inventory, recordUnreadable, verified),
  };
}
