import type { CatalogData } from "../metadata/domain/catalog";

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
