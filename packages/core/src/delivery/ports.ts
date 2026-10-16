import type { TableAttributes } from "./domain/recording";

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
  // The record bases (paths without extension) in a <scope>/<class> folder, in the global domain
  // and every other one (domains/<domain>/<scope>/<class>), at a commit or in the working tree
  // (`at` null), relative to the metadata root.
  recordsIn(folder: string, at: string | null): Promise<string[]>;
  // A file's text in the working tree, or null when it does not exist.
  text(path: string): Promise<string | null>;
  // A YAML file parsed, in the working tree (`at` null) or at a commit; null when absent.
  document(path: string, at: string | null): Promise<unknown | null>;
  // waivers.yaml at the workspace root as committed (parsed, or null when there is none), and
  // whether the working tree differs. Only committed waivers apply: they are reviewed in git.
  waivers(): Promise<{ readonly committed: unknown | null; readonly uncommitted: boolean }>;
  // Files under the metadata root whose working copy differs from HEAD, relative to it.
  uncommittedFiles(): Promise<string[]>;
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

// ADR-0024: a browser session signed in as the profile's user and elevated to security_admin,
// for the records only that role may write. It reads the user's current update set at sign-in,
// so push opens it after switching that; closing it signs out, which ends the elevation.
export interface ElevatedSession {
  // The user the session signed in as, checked against the profile's.
  readonly username: string;
  readonly writer: InstanceWriter;
  close(): Promise<void>;
}

export interface ElevatedSessions {
  open(signal: AbortSignal): Promise<ElevatedSession>;
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

// A Fluent project built for delivery (ADR-0028 as amended): the update XML its build
// produced, to load into the batch, and a digest of their content for the plan id.
export interface FluentPackage {
  // Relative to the workspace: source/<scope>.
  readonly project: string;
  // The application's scope and its sys_id, from the project's now.config.json.
  readonly scope: string;
  readonly scopeId: string;
  // Push loads records into an update set, which only a project of type "configuration" builds
  // (ADR-0028 as amended, item 1); a "package" project builds a whole application.
  readonly configuration: boolean;
  readonly files: readonly { readonly name: string; readonly content: string }[];
  // Of the files' content: gzipped values compared as text, the SBOM's random fields left
  // out, so the same source always gives the same digest (ASR-13).
  readonly digest: string;
}

export interface FluentPackages {
  // Builds each Fluent project with a file changed since `commit`, in a copy.
  changedSince(commit: string): Promise<readonly FluentPackage[]>;
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
    files: FluentPackage["files"],
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

// The instance's data dictionary, as delivery needs it (ADR-0030): each table's parent and its
// collection entry's attributes, which say whether the platform records its records.
export interface TableDictionary {
  tables(names: readonly string[], signal: AbortSignal): Promise<readonly TableAttributes[]>;
}
