import type { CatalogData } from "../metadata/domain/catalog";
import type { RenderedRecord } from "../metadata/domain/record-layout";

export interface PullCheckpoint {
  // Raw UTC timestamp at which the interrupted full pull started (its future watermark).
  readonly startedAt: string;
  readonly completedClasses: readonly string[];
  readonly records: number;
}

export interface SyncState {
  // Changes at or after this raw UTC timestamp (minus the overlap) are not yet mirrored.
  readonly watermark: string;
  readonly lastFullPull: string;
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

export interface MirrorSession extends MirrorWriter {
  // Commits the finished pull to the instance's remote branch and returns the commit id.
  finish(message: string): Promise<string>;
  // Stops writing; durable progress is kept for a resumed pull.
  abort(): Promise<void>;
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
