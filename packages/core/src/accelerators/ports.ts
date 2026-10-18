import type { MaterializedFile } from "./domain/materialize";
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
  ): Promise<{ readonly status: ImportStatus; readonly sysId: string }>;
}
