// A record as stored: its parsed YAML document and its field files.
export interface RecordFiles {
  readonly document: unknown;
  readonly files: readonly { readonly field: string; readonly content: string }[];
}

// The workspace as delivery sees it: the instance's mirror branch and the working tree.
export interface DeliveryWorkspace {
  // instances/<name>/metadata, relative to the workspace root.
  readonly metadataRoot: string;
  // The mirror branch's commit (the instance as last pulled), or null before the first pull.
  mirrorCommit(): Promise<string | null>;
  // Whether the working branch contains that commit (the mirror is integrated).
  includes(commit: string): Promise<boolean>;
  branch(): Promise<string>;
  // Files that differ between `commit` and the working tree (edited, added, deleted),
  // relative to the metadata root.
  changedFiles(commit: string): Promise<string[]>;
  // A record's files in the working tree (`at` null) or at a commit; null when it has none.
  read(base: string, at: string | null): Promise<RecordFiles | null>;
  // A file's text in the working tree, or null when it does not exist.
  text(path: string): Promise<string | null>;
  // The parsed waivers.yaml at the workspace root, or null when there is none.
  waivers(): Promise<unknown | null>;
}

// Writes to a development instance's tables (Table API). Never retried: a write whose outcome
// is unknown fails, and the push stops (ADR-0016).
export interface InstanceWriter {
  insert(
    table: string,
    values: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, string>>>;
  update(
    table: string,
    sysId: string,
    values: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, string>>>;
}

// What a push has done so far, written before every instance write, so an interrupted push
// can be recovered: names and hashes only, never field values or credentials.
export interface PushJournal {
  readonly planId: string;
  readonly mirrorCommit: string;
  readonly startedAt: string;
  // The current-update-set preference while it is switched, to restore it.
  readonly preference: {
    readonly sysId: string;
    readonly name: string;
    readonly previousValue: string;
  } | null;
  readonly steps: readonly {
    readonly operation: string;
    readonly table: string;
    readonly sysId: string;
    readonly state: "sending" | "written";
  }[];
}

export interface PushJournalStore {
  read(): Promise<PushJournal | null>;
  write(journal: PushJournal): Promise<void>;
  clear(): Promise<void>;
}
