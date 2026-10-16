// The workspace as delivery sees it: the instance's mirror branch and the git working tree.
export interface DeliveryWorkspace {
  // instances/<name>/metadata, relative to the workspace root.
  readonly metadataRoot: string;
  // The mirror branch's commit (the instance as last pulled), or null before the first pull:
  // the base validate compares with.
  mirrorCommit(): Promise<string | null>;
  branch(): Promise<string>;
  // waivers.yaml at the workspace root as committed (parsed, or null when there is none), and
  // whether the working tree differs. Only committed waivers apply: they are reviewed in git.
  waivers(): Promise<{ readonly committed: unknown | null; readonly uncommitted: boolean }>;
  // Pushes the branch to its remote (origin when it has none), setting it as upstream.
  publishBranch(branch: string): Promise<void>;
  // Files under source/ that differ from HEAD (edited, staged or new), workspace-relative.
  uncommittedSource(): Promise<string[]>;
  // Commits exactly these workspace-relative files, whatever else is staged; returns the commit.
  commitFiles(paths: readonly string[], message: string): Promise<string>;
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

// Writes to a development instance's tables (Table API), for push's bookkeeping only: update
// sets and the user's preferences; metadata is only ever loaded (ADR-0031). Never retried: a
// write whose outcome is unknown fails, and the push stops (ADR-0016).
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

export interface SwitchedPreference {
  readonly sysId: string;
  readonly user: string;
  readonly name: string;
  readonly previousValue: string;
}

// What a push has done so far, written before every instance write, so an interrupted push
// can be recovered: names and hashes only, never field values or credentials.
export interface PushJournal {
  readonly planId: string;
  readonly mirrorCommit: string;
  readonly startedAt: string;
  // The user's preferences push switched (current update set, current application), still to
  // be restored.
  readonly preferences: readonly SwitchedPreference[];
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

export interface FluentPublishResult {
  readonly sysId: string;
  readonly published: boolean;
  // The platform's message, for example "Published successfully" or why it failed.
  readonly message: string;
}

// The instance side of flow delivery: the ServiceNow IDE's two endpoints, which the SDK itself
// calls. Never retried (ADR-0016): a load or publish whose outcome is unknown stops the push.
export interface FluentInstaller {
  // POST /api/fluent/load/<scopeId>?targetUpdateSetId=<set>: the records, as drafts, with their
  // update records in that set.
  load(
    scopeId: string,
    files: readonly { readonly name: string; readonly content: string }[],
    updateSet: string,
    signal: AbortSignal,
  ): Promise<void>;
  // POST /api/now/wfa_fluent/activate_flows: publishes and compiles; one result per record.
  publish(
    scope: string,
    records: { readonly flows: readonly string[]; readonly actions: readonly string[] },
    signal: AbortSignal,
  ): Promise<readonly FluentPublishResult[]>;
}
