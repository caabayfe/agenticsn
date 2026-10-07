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
  // waivers.yaml at the workspace root as committed (parsed, or null when there is none), and
  // whether the working tree differs. Only committed waivers apply: they are reviewed in git.
  waivers(): Promise<{ readonly committed: unknown | null; readonly uncommitted: boolean }>;
  // Files under the metadata root whose working copy differs from HEAD, relative to it.
  uncommittedFiles(): Promise<string[]>;
  // Pushes the branch to its remote (origin when it has none), setting it as upstream.
  publishBranch(branch: string): Promise<void>;
}

// A branch's pull request as the git platform reports it (ADR-0022). `unavailable`: the
// platform could not be asked (CLI missing, not signed in, no remote on the platform).
export type PullRequestLookup =
  | { readonly kind: "found"; readonly url: string }
  | { readonly kind: "none" }
  | { readonly kind: "unavailable"; readonly reason: string };

// The git platform, through its own CLI and sign-in: snagentic never handles its tokens.
export interface PullRequests {
  find(branch: string, signal: AbortSignal): Promise<PullRequestLookup>;
  // The repository's default branch, or null when the platform cannot say.
  defaultBranch(signal: AbortSignal): Promise<string | null>;
  // Opens a draft pull request from an already published branch; returns its URL.
  openDraft(
    request: { readonly branch: string; readonly title: string; readonly body: string },
    signal: AbortSignal,
  ): Promise<string>;
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
