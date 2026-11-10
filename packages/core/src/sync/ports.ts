import type { PulledRecord } from "../authoring/domain/drift";
import type { CatalogData } from "../metadata/domain/catalog";
import type { RenderedRecord } from "../metadata/domain/record-layout";
import type { SecretRedaction } from "../metadata/domain/secret-scan";
import type { TableFingerprint } from "./domain/fingerprint";

// Fingerprints of the change sources a pull has mirrored, by table.
export type Fingerprints = Readonly<Record<string, TableFingerprint>>;

export interface PullCheckpoint {
  // Raw UTC timestamp at which the interrupted full pull started (its future watermark).
  readonly startedAt: string;
  readonly completedClasses: readonly string[];
  readonly records: number;
  // Taken when the pull started, so changes made while it ran are seen by the next pull.
  readonly fingerprints?: Fingerprints;
  readonly inventory?: Readonly<Record<string, string>>;
  // The redaction policy version the pull started under; absent means 1 (ADR-0034 #2).
  readonly redactionVersion?: number;
  // Secret redactions already written by a resumable full pull (ADR-0035).
  readonly secretRedactions?: readonly SecretRedaction[];
  // Existing progress files have been scanned under this ASR-08 policy version.
  readonly secretScanVersion?: number;
}

export type ExistingMirrorFile =
  | { readonly kind: "document"; readonly path: string; readonly document: unknown }
  | { readonly kind: "text"; readonly path: string; readonly text: string };

export interface SyncState {
  // Changes at or after this raw UTC timestamp (minus the overlap) are not yet mirrored.
  readonly watermark: string;
  readonly lastFullPull: string;
  // Absent sources (older state, unreadable tables) count as changed.
  readonly fingerprints?: Fingerprints;
  // Change signatures of the operational inventory's sources (inventory file -> signature).
  readonly inventory?: Readonly<Record<string, string>>;
  // Classes and tables the user could not read, as found by the pulls since the last full one.
  readonly unreadable?: readonly string[];
  // pull --verify: rows counted per part but not listable by this user (verify-buckets).
  readonly hiddenCounts?: Readonly<Record<string, number>>;
  // The redaction policy version the mirror was pulled with; absent means 1 (ADR-0034 #2).
  readonly redactionVersion?: number;
  // Existing committed files have been scanned under this ASR-08 policy version (ADR-0035).
  readonly secretScanVersion?: number;
  // The instance user whose listings the mirror's membership reflects: the user of the full
  // pull it continues from (ADR-0052 item 4). Absent in state an earlier version wrote.
  readonly pulledBy?: string;
  // The snagentic version that wrote this state.
  readonly snagenticVersion?: string;
}

// The state a pull continues from (ADR-0052): the state and catalog come from the mirror commit,
// or, for a workspace an earlier version pulled, from .snagentic/<name>/ until its next pull
// commit carries them. The checkpoint of an interrupted pull belongs to this clone.
export interface SyncStateStore {
  readCatalog(): Promise<CatalogData | null>;
  readState(): Promise<SyncState | null>;
  readCheckpoint(): Promise<PullCheckpoint | null>;
  writeCheckpoint(checkpoint: PullCheckpoint): Promise<void>;
  clearCheckpoint(): Promise<void>;
  // True while the state is still the one an earlier version kept in .snagentic/<name>/.
  heldLocally(): Promise<boolean>;
  // A pull that found nothing new leaves the mirror commit as it is; this clone remembers that
  // it checked, with the later watermark, for as long as the mirror stays at that commit.
  noteUnchanged(state: SyncState): Promise<void>;
  // Once a pull commit holds the state: drops what an earlier version kept locally.
  forgetLocalState(): Promise<void>;
}

// What a pull in progress writes: the state and catalog go into its own mirror commit.
export interface PullStateStore extends SyncStateStore {
  writeCatalog(data: CatalogData): Promise<void>;
  writeState(state: SyncState): Promise<void>;
}

// Where a pull writes the mirror. `root` is a path prefix inside the mirror, such as
// instances/<name>/metadata.
export interface MirrorWriter {
  write(root: string, rendered: RenderedRecord): Promise<void>;
  writeDocument(root: string, path: string, document: unknown): Promise<void>;
  writeText(root: string, path: string, text: string): Promise<void>;
  existingFiles(root: string): AsyncIterable<ExistingMirrorFile>;
  move(root: string, from: string, to: string): Promise<void>;
  // Every record base under `root`, including those written by an interrupted earlier run.
  bases(root: string): AsyncIterable<string>;
  // Makes everything written so far durable; called before a class is recorded as done.
  checkpoint(): Promise<void>;
}

export interface FinishedPull {
  // The tip of the instance's remote branch.
  readonly commit: string;
  // False when the pull changed nothing and the branch stayed where it was.
  readonly created: boolean;
}

export interface MirrorSession extends MirrorWriter {
  // Commits the finished pull to the instance's remote branch.
  finish(message: string): Promise<FinishedPull>;
  // Stops writing; durable progress is kept for a resumed pull.
  abort(): Promise<void>;
}

// Where a mirror session starts: an empty tree, an interrupted pull's progress, or the
// instance's remote branch.
export type MirrorMode = "fresh" | "resume" | "incremental";

// The mirrored tree an incremental pull starts from, kept current as the pull changes it.
// Paths and bases are relative to `root`.
export interface MirrorTree {
  // Base of the mirrored record with this sys_id.
  baseOf(root: string, sysId: string): string | undefined;
  // Every file of a record: its YAML, field files and child-row files.
  filesOf(root: string, base: string): readonly string[];
  // Record base -> number of child rows of `table` mirrored for it, including changes made
  // earlier in this pull.
  countChildRows(root: string, table: string): Promise<ReadonlyMap<string, number>>;
  // Child-row sys_id -> base of the record whose child-row file holds it, for these tables.
  childRowOwners(root: string, tables: readonly string[]): Promise<ReadonlyMap<string, string>>;
  // A YAML file as this pull has left it so far, read as text values; null when there is none.
  readDocument(root: string, path: string): Promise<unknown>;
}

export interface IncrementalMirror extends MirrorSession, MirrorTree {
  // Reads the mirrored tree; an incremental pull calls it only once something changed.
  prepare(): Promise<void>;
  remove(root: string, path: string): Promise<void>;
}

export interface IntegrationResult {
  // The commit now checked out, or null when the workspace was already up to date.
  readonly commit: string | null;
  readonly changedFiles: number;
  // Mirror files edited locally, replaced by the instance's copy: the mirror is read-only
  // (ADR-0031 item 2).
  readonly discarded: readonly string[];
  // Records the merge brought in changed, with their stamps, for the drift report.
  readonly pulled: readonly PulledRecord[];
}

export interface IntegrationOptions {
  // The update names of the records adopted units track on this instance: only these are
  // reported in `pulled`. None (or absent): no record is read, the drift report is empty.
  readonly adopted?: ReadonlySet<string>;
  readonly progress?: (event: { message: string; completed?: number; total?: number }) => void;
}

// Brings an instance's remote branch into the workspace's current branch with a git merge.
export interface MirrorIntegrator {
  integrate(
    root: string,
    instance: string,
    options?: IntegrationOptions,
  ): Promise<IntegrationResult>;
}

export interface MirrorView {
  // Tip of servicenow-remote/<name>; null before the first completed pull.
  readonly remoteCommit: string | null;
  // Pull commits on the remote branch not yet merged into the current branch.
  readonly unintegratedPulls: number;
  // Synced files changed locally since the last integration, committed or not, and new ones.
  readonly localChanges: readonly string[];
}

// Reads, without changing anything, how the workspace relates to an instance's mirror.
export interface MirrorInspector {
  inspect(root: string, instance: string): Promise<MirrorView>;
}

// The tip of servicenow-remote/<name> on the team's git remote (ADR-0052).
export interface SharedTip {
  readonly commit: string;
  // Null when the commit carries no pull state (an earlier version pushed it).
  readonly state: SyncState | null;
}

// The team's copy of the mirror branch on a git remote, reached with the developer's own git
// credentials. Instance secrets never reach git.
export interface SharedMirror {
  // Fetches servicenow-remote/<name>; null when the remote has no such branch yet.
  fetch(root: string, instance: string, remote: string): Promise<SharedTip | null>;
  // The tip of the local servicenow-remote/<name>.
  localTip(root: string, instance: string): Promise<string | null>;
  // True when `descendant` is `ancestor` or contains it in its history.
  contains(root: string, descendant: string, ancestor: string): Promise<boolean>;
  // Moves the local servicenow-remote/<name> to `commit`, only while it is still at `expected`
  // (null: no branch yet).
  moveTo(
    root: string,
    instance: string,
    move: { readonly commit: string; readonly expected: string | null },
  ): Promise<void>;
  // Pushes `commit` as servicenow-remote/<name>, fast-forward only.
  publish(
    root: string,
    instance: string,
    remote: string,
    commit: string,
  ): Promise<"published" | "rejected">;
}

// Values grouped by key on local disk while a child table is listed, so a pull holds a page and
// one owner's rows, not the whole table (PERF-07). Values are plain JSON data, already
// redacted and secret-scanned: a spill never holds what the mirror may not.
export interface KeyedSpill<T> {
  add(key: string, value: T): Promise<void>;
  // Each key once, with its values in the order they were added; keys in no particular order.
  // Read once.
  groups(): AsyncIterable<readonly [string, readonly T[]]>;
  // Removes what was spilled; safe to call more than once.
  close(): Promise<void>;
}

export interface SpillStore {
  open<T>(): Promise<KeyedSpill<T>>;
  // Removes spills an interrupted pull left behind; returns how many. Called by a pull while
  // it holds the instance's workspace lock.
  sweep(): Promise<number>;
}
