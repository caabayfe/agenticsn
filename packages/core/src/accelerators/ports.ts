import type { MaterializedFile, PatchTarget } from "./domain/materialize";

// Where accelerator packs come from: the first-party packs embedded in snagentic (ADR-0026).
export interface PackSource {
  // Pack ids, sorted.
  ids(): Promise<readonly string[]>;
  // A pack's accelerator.yaml, parsed; null when there is no such pack.
  manifest(id: string): Promise<unknown | null>;
  // Every file of the pack, by path in the pack ("metadata/base/global/...").
  files(id: string): Promise<ReadonlyMap<string, string>>;
}

// The workspace side of `accelerator add` for one instance (ADR-0026, item 2): the pack's files
// are committed to a pack branch with git plumbing, on the instance's mirror, then merged into
// the working branch, so later versions meet the user's edits as a three-way merge.
export interface PackWorkspace {
  // The instance's mirror commit, or null before its first pull.
  mirrorCommit(): Promise<string | null>;
  // Whether the working branch contains that commit (the mirror is integrated).
  includes(commit: string): Promise<boolean>;
  // The mirrored records with these sys_ids at `commit`, by sys_id.
  mirrored(commit: string, sysIds: readonly string[]): Promise<ReadonlyMap<string, PatchTarget>>;
  // A YAML document's text, parsed.
  parse(text: string): unknown;
  // Commits the files onto the mirror commit as the pack branch's next commit; returns the
  // branch's commit, unchanged when its content would be the same.
  commit(
    pack: string,
    mirror: string,
    files: readonly MaterializedFile[],
    message: string,
  ): Promise<string>;
  // Merges the pack branch into the working branch; the files left in conflict, if any.
  merge(pack: string): Promise<{ readonly branch: string; readonly conflicts: readonly string[] }>;
}
