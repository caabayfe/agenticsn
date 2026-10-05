import type { RenderedRecord } from "./domain/record-layout";

export interface StoredRecord {
  // Relative to the metadata folder, without extension (see recordBase).
  readonly base: string;
  // The parsed YAML document, every scalar as a string (ADR-0015).
  readonly document: unknown;
  readonly files: readonly { readonly field: string; readonly content: string }[];
  readonly children: readonly { readonly table: string; readonly content: string }[];
}

// Records on disk in the flat layout (ADR-0017). `root` is an instance's metadata folder.
export interface RecordStore {
  // `previousPaths` are the field files of the record's previous version; those no longer
  // produced are removed.
  write(root: string, rendered: RenderedRecord, previousPaths?: readonly string[]): Promise<void>;
  // Writes any YAML document at a path relative to `root` (child rows, operational tables).
  writeDocument(root: string, path: string, document: unknown): Promise<void>;
  remove(root: string, base: string): Promise<void>;
  read(root: string, base: string): Promise<StoredRecord | null>;
  // Streams every record; files of one class folder are read once.
  list(root: string): AsyncIterable<StoredRecord>;
  // Every record base, from file names only (no content is read).
  bases(root: string): AsyncIterable<string>;
}
