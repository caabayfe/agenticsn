import {
  InstanceName,
  instancePaths,
  type MirrorInspector,
  type MirrorView,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "./run-git";

async function revParse(root: string, ref: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", ref], root);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

const lines = (text: string) => text.split("\n").filter(Boolean);

// Synced files that differ from the last integrated pull (the merge base): local edits,
// committed or not, plus new files. Changes still waiting on the remote branch are not
// local, so they are not compared.
async function localChanges(root: string, base: string, owned: readonly string[]) {
  const edited = await runGitOrThrow(
    ["diff", "--name-only", "--no-renames", base, "--", ...owned],
    root,
  );
  const added = await runGitOrThrow(
    ["ls-files", "--others", "--exclude-standard", "--", ...owned],
    root,
  );
  return [...new Set([...lines(edited), ...lines(added)])].sort();
}

async function inspect(root: string, instance: string): Promise<MirrorView> {
  const paths = instancePaths(InstanceName.parse(instance));
  const remoteCommit = await revParse(root, paths.remoteBranch);
  if (remoteCommit === null) {
    return { remoteCommit, unintegratedPulls: 0, localChanges: [] };
  }
  const head = await revParse(root, "HEAD");
  const range = head === null ? remoteCommit : `${head}..${remoteCommit}`;
  const unintegratedPulls = Number(
    (await runGitOrThrow(["rev-list", "--count", range], root)).trim(),
  );
  const base = head === null ? null : await mergeBase(root, head, remoteCommit);
  const owned = [paths.metadata, paths.operational];
  return {
    remoteCommit,
    unintegratedPulls,
    localChanges: base === null ? [] : await localChanges(root, base, owned),
  };
}

async function mergeBase(root: string, head: string, remote: string): Promise<string | null> {
  const result = await runGit(["merge-base", head, remote], root);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export const gitInspector: MirrorInspector = { inspect };
