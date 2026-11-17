import { runGit, runGitOrThrow } from "../git/run-git";

interface CommitIndex {
  readonly head: string | null;
  readonly staged: ReadonlySet<string>;
}

export async function readCommitIndex(root: string): Promise<CommitIndex> {
  const head = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], root);
  const staged = await runGitOrThrow(["diff", "--cached", "--name-only", "-z"], root);
  return {
    head: head.exitCode === 0 ? head.stdout.trim() : null,
    staged: new Set(staged.split("\0").filter(Boolean)),
  };
}

// A path-limited commit uses a temporary index. A hook can legitimately add generated keys
// to that commit, while Git leaves their old entries in the real index. Reconcile only paths
// committed by this operation that had no staged change beforehand; preserve partial staging
// and every working file, including an unstaged edit to a hook's output.
export async function reconcileCommitIndex(root: string, before: CommitIndex, tip: string) {
  const range = before.head === null ? ["--root", tip] : [before.head, tip];
  const changed = await runGitOrThrow(
    ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", ...range],
    root,
  );
  const paths = changed.split("\0").filter((path) => path !== "" && !before.staged.has(path));
  if (paths.length === 0) return;
  await runGitOrThrow(
    [
      "restore",
      "--staged",
      `--source=${tip}`,
      "--",
      ...paths.map((path) => `:(top,literal)${path}`),
    ],
    root,
  );
}
