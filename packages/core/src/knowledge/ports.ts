import type { IndexedRecord, RecordFields } from "./domain/indexed-record";

// Where the index stands: the commit it was built from, and the files that were edited
// locally at the time (re-read next time, in case the edit was undone).
export interface IndexMarker {
  readonly commit: string;
  readonly dirty: readonly string[];
}

export interface SearchQuery {
  readonly text?: string;
  readonly className?: string;
  readonly scope?: string;
  readonly table?: string;
  readonly limit: number;
}

// The instance's knowledge index (local, rebuilt from the mirror at any time).
export interface KnowledgeStore {
  marker(): Promise<IndexMarker | null>;
  // Applies a batch atomically. The marker is written with the last batch of a refresh only,
  // so an interrupted refresh is repeated rather than trusted.
  apply(
    upserts: readonly IndexedRecord[],
    removed: readonly string[],
    marker: IndexMarker | null,
  ): Promise<void>;
  search(
    query: SearchQuery,
  ): Promise<{ readonly records: readonly IndexedRecord[]; readonly total: number }>;
  onTables(tables: readonly string[]): Promise<readonly IndexedRecord[]>;
  byBases(bases: readonly string[]): Promise<readonly IndexedRecord[]>;
  bySysId(sysId: string): Promise<IndexedRecord | null>;
  count(): Promise<number>;
}

export interface CodeHit {
  // Relative to instances/<name>/metadata.
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

// The workspace's copy of an instance's metadata, as files in git.
export interface MirrorFiles {
  head(): Promise<string | null>;
  // Record files (relative paths) that differ: committed since `commit` (all of them when
  // null), and edited or added locally now (`dirty`).
  changes(
    commit: string | null,
  ): Promise<{ readonly committed: readonly string[]; readonly dirty: readonly string[] }>;
  // A record file's fields; null when the file no longer exists.
  readRecord(path: string): Promise<RecordFields | null>;
  // Files beside a record (scripts and other long fields, child rows).
  filesOf(base: string): Promise<readonly string[]>;
  // Fixed-string search through the files, most relevant first, at most `limit` hits.
  grep(text: string, limit: number): Promise<readonly CodeHit[]>;
}
