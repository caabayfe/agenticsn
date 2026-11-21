import type { MirrorMode } from "@snagentic/core";
import { removeTemporaryPacks } from "./git-pack-cleanup";
import { runGit } from "./run-git";

async function failureOf(args: readonly string[], repository: string): Promise<string | null> {
  try {
    const result = await runGit(args, repository);
    return result.exitCode === 0 ? null : result.stderr.trim() || `exit ${result.exitCode}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// A full pull ends with one optimized pack; unreachable progress objects are dropped
// (reflog-reachable objects are kept, so local history is safe). Measured on the PDI:
// 585 MB -> 230 MB in 11 s. Incremental pulls add small packs that git consolidates
// when they pile up. The pull is already committed when this runs: a failure (a full disk, a
// lock) leaves the mirror whole and only larger on disk, so it is returned as a warning,
// never thrown.
export async function compactMirror(
  repository: string,
  mode: MirrorMode,
  openedAt: number,
): Promise<string | null> {
  const steps =
    mode === "incremental"
      ? [["gc", "--auto", "--quiet"]]
      : [
          ["repack", "-a", "-d", "-q"],
          ["prune-packed", "-q"],
        ];
  for (const args of steps) {
    const failure = await failureOf(args, repository);
    if (failure !== null) {
      await removeTemporaryPacks(repository, openedAt);
      return `the mirror is committed, but git ${args[0]} could not pack the repository (${failure}); once that is fixed, run git gc in the workspace to reclaim the space`;
    }
  }
  return null;
}
