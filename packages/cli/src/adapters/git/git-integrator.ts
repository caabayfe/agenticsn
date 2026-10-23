import {
  InstanceName,
  type IntegrationOptions,
  type IntegrationResult,
  instancePaths,
  type MirrorIntegrator,
  NothingPulledError,
  SnagenticError,
} from "@snagentic/core";
import { pulledRecords } from "./pulled-records";
import { runGit, runGitOrThrow } from "./run-git";

class IntegrationBlockedError extends SnagenticError {
  constructor(code: string, message: string, hint: string) {
    super(code, "precondition", message, hint);
  }
}

const FALLBACK_IDENTITY = ["-c", "user.name=snagentic", "-c", "user.email=snagentic@localhost"];

const lines = (text: string): string[] => text.split("\n").filter(Boolean);

async function ensureIntegrable(root: string, instance: string) {
  const paths = instancePaths(InstanceName.parse(instance));
  if (
    (await runGit(["rev-parse", "--verify", "--quiet", paths.remoteBranch], root)).exitCode !== 0
  ) {
    throw new NothingPulledError(instance);
  }
  // Only tracked changes in what the mirror owns block a merge. Untracked files (such as
  // the instance profile) are kept; git itself refuses to overwrite one on a collision.
  const owned = [paths.metadata, paths.operational];
  const status = ["status", "--porcelain", "--untracked-files=no", "--", ...owned];
  if ((await runGitOrThrow(status, root)).trim() !== "") {
    throw new IntegrationBlockedError(
      "uncommitted-changes",
      `${paths.root} has uncommitted changes to synced files`,
      "restore them (git checkout -- instances): the mirror is written only by pull",
    );
  }
  return { branch: paths.remoteBranch, owned };
}

// A brand-new workspace has no commit yet: start its history from the pull.
async function startFrom(root: string, branch: string): Promise<IntegrationResult> {
  await runGitOrThrow(["reset", "-q", branch], root);
  await runGitOrThrow(["checkout", "-q", "--", "."], root);
  const commit = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
  const files = lines(await runGitOrThrow(["ls-tree", "-r", "--name-only", "HEAD"], root));
  return { commit, changedFiles: files.length, discarded: [], pulled: [] };
}

// Files git names when it will not overwrite them: one per tab-indented line, or one quoted.
function untrackedInTheWay(stderr: string): string[] {
  const listed = stderr
    .split("\n")
    .filter((line) => line.startsWith("\t"))
    .map((line) => line.trim());
  const single = /Untracked working tree file '(.+)' would be overwritten/.exec(stderr)?.[1];
  return listed.length > 0 ? listed : single === undefined ? [] : [single];
}

// git refused to start the merge (no MERGE_HEAD): committing now would commit nothing but
// whatever the index holds.
function refused(stderr: string): IntegrationBlockedError {
  const files = untrackedInTheWay(stderr);
  const more = files.length > 3 ? ", ..." : "";
  const reason =
    files.length > 0
      ? `${files.length} untracked file(s) would be overwritten: ${files.slice(0, 3).join(", ")}${more}`
      : (stderr.trim().split("\n")[0] ?? "");
  return new IntegrationBlockedError(
    "merge-refused",
    `git refused to start the merge: ${reason}`,
    "an interrupted integrate leaves copies of the pulled files; delete the untracked files under the instance's metadata folder, then integrate again",
  );
}

// The pre-commit hook (validate) refused the merge commit: the merge stays in progress.
function commitRefused(output: string): IntegrationBlockedError {
  const reported = lines(output)
    .map((line) => line.trim())
    .slice(0, 5)
    .join("; ");
  return new IntegrationBlockedError(
    "commit-refused",
    `the pre-commit check blocked the merge commit: ${reported}`,
    "fix what it reports (snagentic validate --staged lists it), then run: git commit",
  );
}

// After the merge, every mirror file the index holds differently from the instance's copy is a
// local edit: it takes the instance's copy, or goes when the instance has none.
async function takeInstance(root: string, branch: string, owned: readonly string[]) {
  const differing = lines(
    await runGitOrThrow(
      ["diff", "--cached", "--name-only", "--no-renames", branch, "--", ...owned],
      root,
    ),
  );
  const unmerged = lines(await runGitOrThrow(["diff", "--name-only", "--diff-filter=U"], root));
  const files = [...new Set([...differing, ...unmerged])].sort();
  for (const file of files) {
    const there = (await runGit(["cat-file", "-e", `${branch}:${file}`], root)).exitCode === 0;
    if (there) await runGitOrThrow(["checkout", branch, "--", file], root);
    else await runGitOrThrow(["rm", "-q", "--cached", "--ignore-unmatch", "--", file], root);
  }
  return files;
}

async function merge(
  root: string,
  instance: string,
  before: string,
  options: IntegrationOptions,
): Promise<IntegrationResult> {
  const { branch, owned } = await ensureIntegrable(root, instance);
  const related = (await runGit(["merge-base", "HEAD", branch], root)).exitCode === 0;
  const configured = (await runGit(["config", "user.email"], root)).stdout.trim() !== "";
  const identity = configured ? [] : FALLBACK_IDENTITY;
  const args = [
    ...identity,
    ...["merge", "--no-ff", "--no-commit", "-m", `snagentic integrate ${instance}`],
    ...(related ? [] : ["--allow-unrelated-histories"]),
    branch,
  ];
  const attempt = await runGit(args, root);
  const merging = (await runGit(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], root)).exitCode;
  if (attempt.exitCode !== 0 && merging !== 0) throw refused(attempt.stderr);
  const discarded = await takeInstance(root, branch, owned);
  const committed = await runGit([...identity, "commit", "-q", "--no-edit"], root);
  if (committed.exitCode !== 0) throw commitRefused(`${committed.stdout}\n${committed.stderr}`);
  const commit = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
  const changed = lines(await runGitOrThrow(["diff", "--name-only", before, commit], root));
  const metadata = owned[0] ?? "";
  return {
    commit,
    changedFiles: changed.length,
    discarded,
    pulled: await pulledRecords(root, { from: before, to: commit, metadata }, options),
  };
}

// `integrate` (ADR-0007, ADR-0031): the instance's copy is merged into the current branch. The
// mirror is read-only, so the instance's copy always wins there.
async function integrate(
  root: string,
  instance: string,
  options: IntegrationOptions = {},
): Promise<IntegrationResult> {
  const { branch } = await ensureIntegrable(root, instance);
  const head = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], root);
  if (head.exitCode !== 0) {
    options.progress?.({ message: "integrate: checking out the pull" });
    return startFrom(root, branch);
  }
  if ((await runGit(["merge-base", "--is-ancestor", branch, "HEAD"], root)).exitCode === 0) {
    return { commit: null, changedFiles: 0, discarded: [], pulled: [] };
  }
  options.progress?.({ message: "integrate: merging the pull" });
  return merge(root, instance, head.stdout.trim(), options);
}

export const gitIntegrator: MirrorIntegrator = { integrate };
