import { SnagenticError } from "../../kernel/errors";
import { Catalog, type CatalogData } from "../../metadata/domain/catalog";
import { type SecretRedaction, sortSecretRedactions } from "../../metadata/domain/secret-scan";
import { changesSince, type FingerprintChange } from "../domain/fingerprint";
import type { InventorySource } from "../domain/inventory";
import { CHILD_TABLES } from "../domain/pull-scope";
import type { Fingerprints, SyncState } from "../ports";
import { detectChanges } from "./detect-changes";
import { isIdle, refuseFutureWatermark, writesInstanceData } from "./incremental-checks";
import { applyChildChanges, type ChildOutcome } from "./incremental-children";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { type RecordStep, recordPhase } from "./incremental-record-phase";
import { pullApplications } from "./pull-applications";
import { type PullProgress, rawTimestamp } from "./pull-dependencies";
import { pullOperational } from "./pull-operational";
import type { RedactionReread } from "./redaction-reread";
import { migrateExistingSecrets, SECRET_SCAN_VERSION } from "./secret-migration";
import { trustedCatalog } from "./trusted-catalog";
import type { RecordVerification, VerifiedRecords } from "./verify-records";

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
  // Property values redacted because they don't have their type's shape (ADR-0034).
  readonly malformedValues: number;
  // Classes and child tables read again because the redaction policy changed (ADR-0034 #2).
  readonly rereadForRedaction: readonly string[];
  readonly childFiles: number;
  readonly removedChildFiles: number;
  // Records gone from the instance without a deletion record; still in the mirror.
  readonly lostRecords: number;
  // Inventory files listed again because their source changed (or with verify).
  readonly inventoryRefreshed: readonly string[];
  // pull --verify only: what the count comparison found and repaired.
  readonly verification: (RecordVerification & { recovered: number; removed: number }) | null;
  readonly unreadable: readonly string[];
  readonly secretRedactions: readonly SecretRedaction[];
  readonly watermark: string;
  // Nothing moved on the instance and no policy asked for a re-read: the mirror is unchanged.
  readonly idle: boolean;
  // The sync state to store once the mirror commit is durable (see recordPull).
  readonly next: SyncState;
}

export interface PullOptions {
  // Also compare the mirror with the instance by counts and repair what differs.
  readonly verify?: boolean;
}

function summarize(
  changes: ReadonlyMap<string, FingerprintChange>,
  step: RecordStep,
  verified: VerifiedRecords | null,
  reread: RedactionReread,
  children: ChildOutcome,
  unreadable: readonly string[],
): Omit<IncrementalSummary, "watermark" | "next" | "inventoryRefreshed" | "idle"> {
  const { records } = step;
  const secretRedactions: SecretRedaction[] = [
    ...records.secretRedactions,
    ...step.catalogSecretRedactions,
    ...(verified?.records.secretRedactions ?? []),
    ...reread.secretRedactions,
    ...children.secretRedactions,
  ];
  return {
    changedSources: [...changes].filter(([, change]) => change !== "unchanged").map(([t]) => t),
    catalogRefreshed: step.catalogRefreshed || (verified?.catalogRefreshed ?? false),
    records: records.written + reread.records,
    renamed: records.renamed,
    deleted: records.deleted,
    skippedRows: records.skippedRows,
    malformedValues:
      records.malformedValues + (verified?.records.malformedValues ?? 0) + reread.malformedValues,
    rereadForRedaction: reread.tables,
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
    secretRedactions: sortSecretRedactions(secretRedactions),
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
  const remove = deps.absence === "keep" ? undefined : deps.records;
  return stale.some((source) => source.table === "sys_scope")
    ? pullApplications(deps, catalog, signal, remove)
    : { applications: 0, unreadable: [], secretRedactions: [] };
}

function nextState(
  state: SyncState,
  redactionVersion: number,
  startedAt: string,
  fingerprints: Fingerprints,
  inventory: Readonly<Record<string, string>>,
  unreadable: readonly string[],
  verified: VerifiedRecords | null,
): SyncState {
  return {
    ...state,
    redactionVersion,
    secretScanVersion: SECRET_SCAN_VERSION,
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
  records: Awaited<ReturnType<typeof recordPhase>>,
  moved: {
    readonly state: SyncState;
    readonly changes: ReadonlyMap<string, FingerprintChange>;
    readonly stale: readonly InventorySource[];
    readonly since: string;
  },
  signal: AbortSignal,
) {
  const { state, changes, stale, since } = moved;
  const { step, reread, verified } = records;
  const catalog = verified?.catalog ?? step.catalog;
  const created = step.records.created;
  const deleted = step.deleted;
  const neverRead = new Set([
    ...CHILD_TABLES.map((child) => child.table).filter((table) => !state.fingerprints?.[table]),
    // Child tables to list again whole, as if never read (ADR-0034 #2).
    ...reread.childTables,
  ]);
  const children = await applyChildChanges(
    deps,
    catalog,
    changes,
    { since, neverRead, created, deleted },
    signal,
  );
  const applications = await applicationsIfMoved(deps, catalog, stale, signal);
  const operational = await pullOperational(deps, catalog, signal, stale);
  return {
    children,
    unreadable: [...applications.unreadable, ...operational.unreadable],
    secretRedactions: sortSecretRedactions([
      ...applications.secretRedactions,
      ...operational.secretRedactions,
    ]),
  };
}

async function prepareIncremental(
  deps: IncrementalDependencies,
  instance: string,
  signal: AbortSignal,
) {
  const state = await deps.state.readState();
  const stored = await deps.state.readCatalog();
  if (state === null || stored === null) throw new FullPullRequiredError(instance);
  const migration = await migrateExistingSecrets(
    deps.records,
    deps.instanceRoot,
    deps.catalogPath,
    stored,
    state,
    signal,
  );
  if (migration.catalogChanged) await deps.state.writeCatalog(migration.catalog);
  return { state, stored: migration.catalog, migration };
}

// The catalog this pull redacts with, once the instance has said what changed: only a pull that
// writes instance data needs one this clone can rely on (spec 014, SEC2-03).
async function catalogForRun(
  deps: IncrementalDependencies,
  stored: CatalogData,
  run: {
    readonly state: SyncState;
    readonly verify: boolean;
    readonly changes: ReadonlyMap<string, FingerprintChange>;
    readonly stale: number;
  },
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
) {
  const read = writesInstanceData(run.state, deps.policy.version, run)
    ? await trustedCatalog(deps, stored, signal, progress)
    : { catalog: stored, patterns: [], changed: false };
  const secretRedactions: SecretRedaction[] =
    read.patterns.length > 0 ? [{ path: deps.catalogPath, patterns: read.patterns }] : [];
  return { catalog: new Catalog(read.catalog), changed: read.changed, secretRedactions };
}

export async function pullIncremental(
  deps: IncrementalDependencies,
  instance: string,
  signal: AbortSignal,
  progress: (event: PullProgress) => void = () => {},
  options: PullOptions = {},
): Promise<IncrementalSummary> {
  const { state, stored, migration } = await prepareIncremental(deps, instance, signal);
  const verify = options.verify === true;
  const startedAt = rawTimestamp(deps.now());
  progress({ message: "checking for changes" });
  const { current, fingerprintChanges, changes, inventory, stale } = await detectChanges(
    deps,
    state,
    verify,
    signal,
  );
  refuseFutureWatermark(deps, state, instance);
  const scope = { state, verify, changes, stale: stale.length };
  const trusted = await catalogForRun(deps, stored, scope, signal, progress);
  const since = changesSince(state.watermark);
  const run = {
    state,
    catalog: trusted.catalog,
    fingerprints: current.fingerprints,
    change: changes.get("sys_metadata") ?? "changed",
    window: { since, previous: state.watermark, current: startedAt },
    verify,
  };
  const records = await recordPhase(deps, run, signal, progress);
  const { step, reread, verified } = records;
  progress({ message: "child rows" });
  const rest = await pullBesideRecords(deps, records, { state, changes, stale, since }, signal);
  const unreadable = [...current.unreadable, ...records.unreadable, ...rest.unreadable];
  const summary = summarize(fingerprintChanges, step, verified, reread, rest.children, unreadable);
  const rewritten = trusted.changed || migration.secretRedactions.length > 0;
  return {
    ...summary,
    catalogRefreshed: summary.catalogRefreshed || trusted.changed,
    secretRedactions: sortSecretRedactions(
      [migration, trusted, summary, rest].flatMap((part) => part.secretRedactions),
    ),
    inventoryRefreshed: stale.map((source) => source.file),
    watermark: startedAt,
    idle: isIdle(state, deps.policy.version, {
      verify,
      moved: rewritten || summary.changedSources.length + stale.length + reread.tables.length > 0,
    }),
    next: nextState(
      state,
      deps.policy.version,
      startedAt,
      current.fingerprints,
      inventory,
      records.unreadable,
      verified,
    ),
  };
}
