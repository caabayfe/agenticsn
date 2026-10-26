import type { OpenSet } from "./domain/earlier-sets";
import type { ListFact, ListState } from "./domain/ensure";
import type { FormFieldFact, SectionState } from "./domain/ensure-form";
import type { InstallRecord } from "./domain/install-plan";
import type { MaterializedFile } from "./domain/materialize";
import type { RowProblem } from "./domain/row-problems";
import type { Template } from "./domain/templates";
import type { PreviousAdd } from "./domain/upgrade";

// Where accelerator packs come from: the packs embedded in snagentic and those under the
// workspace's pack paths (ADR-0026, ADR-0038).
export interface PackSource {
  // Pack ids, sorted.
  ids(): Promise<readonly string[]>;
  // Every file of the pack, by path in the pack ("modules/<module>/..."); empty when there is no
  // such pack.
  files(id: string): Promise<ReadonlyMap<string, string>>;
  // A pack's YAML document, parsed.
  parse(text: string): unknown;
}

// The workspace side of `accelerator add` for one instance (ADR-0026, item 2): the pack's files,
// by workspace path, are committed to a pack branch with git plumbing, on the instance's mirror, then merged into
// the working branch, so later versions meet the user's edits as a three-way merge.
export interface PackWorkspace {
  // The instance's mirror commit, or null before its first pull.
  mirrorCommit(): Promise<string | null>;
  // Whether the working branch contains that commit (the mirror is integrated).
  includes(commit: string): Promise<boolean>;
  // A YAML document's text, parsed.
  parse(text: string): unknown;
  // The reports of the pack's earlier installs on this instance, as committed.
  installReports(pack: string): Promise<readonly string[]>;
  // Which of these workspace paths the working branch holds (tracked in git).
  present(paths: readonly string[]): Promise<readonly string[]>;
  // What the pack's last add wrote and kept; both empty before its first add.
  previous(pack: string): Promise<PreviousAdd>;
  // Commits the files onto the mirror commit as the pack branch's next commit, with the `keep`
  // paths as the branch's last commit has them, and records both for `previous`; returns the
  // branch's commit, unchanged when its content would be the same.
  commit(
    pack: string,
    mirror: string,
    files: readonly MaterializedFile[],
    message: string,
    keep: readonly string[],
  ): Promise<string>;
  // Merges the pack branch into the working branch; the files left in conflict, if any.
  merge(pack: string): Promise<{ readonly branch: string; readonly conflicts: readonly string[] }>;
}

// A data directory's templates, one CSV per entity (ADR-0026, item 3). Customer data: read to
// validate and load, never written or copied.
export interface DataTemplates {
  // Whether git tracks any file in the directory: customer data must not be committed.
  tracked(directory: string): Promise<boolean>;
  // A template, parsed; null when the file is missing.
  read(directory: string, file: string): Promise<Template | null>;
  // A template's text, parsed (the pack's own demo set).
  parse(text: string): Template;
}

export type ImportStatus = "inserted" | "updated" | "ignored" | "skipped" | "error";

// The Import Set API on a development instance (spike S-B): one request per row, transformed
// synchronously. Never retried: a row whose outcome is unknown fails, and the load stops.
export interface ImportSetWriter {
  post(
    table: string,
    row: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<{
    readonly status: ImportStatus;
    readonly sysId: string;
    // The transform's message for a row it skipped or failed, when the platform gives one.
    readonly message?: string;
  }>;
}

// The steps an install runs, each one an existing use case (ADR-0038, item 2): the install only
// orders them, skips what is done and records what happened. Every write goes through these.
export interface InstallSteps {
  // Activates an installed, inactive plugin and waits for the platform's installer to finish.
  activatePlugin(id: string, signal: AbortSignal): Promise<{ readonly seconds: number }>;
  // pull, then integrate: the mirror (and its component inventory) catches up with the instance.
  refresh(signal: AbortSignal): Promise<void>;
  // accelerator add for these modules: the workspace files it wrote, and those the merge left in
  // conflict.
  add(
    modules: readonly string[],
    signal: AbortSignal,
  ): Promise<{ readonly copied: readonly string[]; readonly conflicts: readonly string[] }>;
  // fluent-keys for the projects holding these files, committed (rule SN-MNT-010).
  keys(paths: readonly string[], signal: AbortSignal): Promise<void>;
  // take-over for the out-of-box records a module declares whole (ADR-0038 item 8): those
  // untouched since shipped become this branch's; customized or absent ones are named.
  takeOver(
    // A restated record is the instance's own copy plus the module's change: taken over even when
    // the client customized it (form_field, D1).
    records: readonly {
      readonly table: string;
      readonly sysId: string;
      readonly restated?: true;
    }[],
    signal: AbortSignal,
  ): Promise<{
    readonly taken: number;
    readonly customized: readonly string[];
    readonly absent: readonly string[];
  }>;
  // plan_push under `label`. A record held only in update sets of `own` labels (this install's
  // own, from an earlier run) is no collision: the install changes its own records.
  planPush(
    label: string,
    signal: AbortSignal,
    own: readonly string[],
  ): Promise<{
    readonly planId: string;
    readonly ready: boolean;
    readonly units: number;
    readonly problems: readonly string[];
  }>;
  push(
    planId: string,
    label: string,
    signal: AbortSignal,
  ): Promise<{
    readonly units: number;
    readonly notApplied: number;
    readonly notCaptured: number;
    readonly updateSets: readonly string[];
    // Each unit not applied as built, with what the instance holds otherwise.
    readonly mismatched: readonly string[];
    // Records the platform skipped during the load, by table and reason, with their action.
    readonly refused: readonly {
      readonly table: string;
      readonly reason: string;
      readonly records: readonly string[];
      readonly action: string;
    }[];
  }>;
  load(
    modules: readonly string[],
    source: { readonly kind: "demo" } | { readonly kind: "directory"; readonly directory: string },
    // The domain the rows go into, by name; null where the instance has no domains.
    domain: string | null,
    signal: AbortSignal,
  ): Promise<{
    readonly entities: readonly {
      readonly entity: string;
      readonly counts: Readonly<Record<ImportStatus, number>>;
      readonly failed: readonly string[];
      readonly problems: readonly RowProblem[];
    }[];
    readonly stopped: boolean;
  }>;
  // Sets these update sets (top-level) to complete on the development instance; their scope
  // children follow (spec 011, spike S-U).
  completeUpdateSets(sets: readonly OpenSet[], signal: AbortSignal): Promise<void>;
  // The related-list layouts the facts name, read live, one per fact in order (ADR-0042).
  layouts(facts: readonly ListFact[], signal: AbortSignal): Promise<readonly ListState[]>;
  // The form sections the facts name, read live, one per fact in order (ADR-0042 form_field).
  sections(facts: readonly FormFieldFact[], signal: AbortSignal): Promise<readonly SectionState[]>;
  // The workspace's project for an application scope, made when it has none (a workspace's
  // section belongs to the workspace application); the files it made, to commit.
  project(scope: {
    readonly name: string;
    readonly sysId: string;
  }): Promise<{ readonly path: string; readonly written: readonly string[] }>;
  // Writes a workspace file (the plan and the report), relative to the workspace root.
  writeFile(path: string, text: string): Promise<void>;
  commit(paths: readonly string[], message: string): Promise<string>;
}

// The instance's install journal and lock (local state, never committed).
export interface InstallJournal {
  read(): Promise<InstallRecord | null>;
  write(record: InstallRecord): Promise<void>;
  clear(): Promise<void>;
  // False when another install holds the lock.
  lock(): Promise<boolean>;
  unlock(): Promise<void>;
}

// The instance's update sets in progress, read live (ADR-0018).
export interface OpenUpdateSets {
  open(signal: AbortSignal): Promise<readonly OpenSet[]>;
}

// The instance's tables as the mirror holds them, read without calling the instance (ADR-0026):
// what the install plan checks a module's required fields against (plan gap G13).
export interface SchemaReader {
  // Whether the mirror holds any table yet (false before the first pull).
  ready(): Promise<boolean>;
  // A table's fields, its parents' included; null when the mirror has no such table.
  fieldsOf(table: string): Promise<readonly string[] | null>;
  // Forgets what it read, so the next question reads the mirror again (after a pull).
  refresh(): void;
}
