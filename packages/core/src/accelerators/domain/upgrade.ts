// What a pack's next add keeps (ADR-0026, M8): snagentic never deletes, so a file the last add
// wrote that this version no longer ships is kept as that add wrote it. Kept as the merge base
// has it, the three-way merge leaves the user's copy alone. Pure.

export interface PreviousAdd {
  // Workspace paths the last add wrote.
  readonly written: readonly string[];
  // Paths it kept from earlier versions.
  readonly kept: readonly string[];
}

export interface Carried {
  // Paths to keep as the last add wrote them.
  readonly keep: readonly string[];
  // Paths this version dropped: reported once, when they are first kept.
  readonly removed: readonly string[];
}

export function carried(previous: PreviousAdd, written: readonly string[]): Carried {
  const now = new Set(written);
  const gone = (path: string) => !now.has(path);
  return {
    keep: [...new Set([...previous.written, ...previous.kept])].filter(gone).sort(),
    removed: previous.written.filter(gone).sort(),
  };
}

// Files an earlier add wrote that no module of this pack version ships, as candidates: the install
// plan names those the workspace still holds and stops until they are removed, since a dropped
// file may restate records the new version declares elsewhere and break the build (pdi2,
// 2026-10-23). Still never deleted by snagentic (M8): the user removes them.
export const noLongerShipped = (previous: PreviousAdd, shipped: readonly string[]) =>
  carried(previous, shipped).keep;

export function leftoverProblem(paths: readonly string[]): string | null {
  if (paths.length === 0) return null;
  const files = paths.length === 1 ? "1 file" : `${paths.length} files`;
  const them = paths.length === 1 ? "it" : "them";
  return `the workspace still holds ${files} this version no longer ships: remove ${them} (git rm ${paths.join(" ")}), commit, then plan again`;
}
