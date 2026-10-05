import type { CatalogData } from "../metadata/domain/catalog";
import type { RenderedRecord } from "../metadata/domain/record-layout";
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
}

export interface SyncState {
  // Changes at or after this raw UTC timestamp (minus the overlap) are not yet mirrored.
  readonly watermark: string;
  readonly lastFullPull: string;
  // Absent sources (older state, unreadable tables) count as changed.
  readonly fingerprints?: Fingerprints;
}

// Local, per-instance sync state (.snagentic/<name>/, never committed).
export interface SyncStateStore {
  readCatalog(): Promise<CatalogData | null>;
  writeCatalog(data: CatalogData): Promise<void>;
  readCheckpoint(): Promise<PullCheckpoint | null>;
  writeCheckpoint(checkpoint: PullCheckpoint): Promise<void>;
  clearCheckpoint(): Promise<void>;
  readState(): Promise<SyncState | null>;
  writeState(state: SyncState): Promise<void>;
}

// Where a pull writes the mirror. `root` is a path prefix inside the mirror, such as
// instances/<name>/metadata.
export interface MirrorWriter {
  write(root: string, rendered: RenderedRecord): Promise<void>;
  writeDocument(root: string, path: string, document: unknown): Promise<void>;
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
}

export interface IncrementalMirror extends MirrorSession, MirrorTree {
  remove(root: string, path: string): Promise<void>;
  move(root: string, from: string, to: string): Promise<void>;
}

export interface IntegrationResult {
  // The commit now checked out, or null when the workspace was already up to date.
  readonly commit: string | null;
  readonly changedFiles: number;
}

// Brings an instance's remote branch into the workspace's current branch with a git merge.
export interface MirrorIntegrator {
  integrate(root: string, instance: string): Promise<IntegrationResult>;
}
