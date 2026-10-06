import {
  InstanceName,
  type IntegrationResult,
  instancePaths,
  type MirrorIntegrator,
  NothingPulledError,
  SnagenticError,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "./run-git";

class IntegrationBlockedError extends SnagenticError {
  constructor(code: string, message: string, hint: string) {
    super(code, "precondition", message, hint);
  }
}

const FALLBACK_IDENTITY = ["-c", "user.name=snagentic", "-c", "user.email=snagentic@localhost"];

function lines(text: string): string[] {
  return text.split("\n").filter(Boolean);
}

async function ensureIntegrable(root: string, instance: string): Promise<string> {
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
      "commit or stash them first, so nothing local is lost",
    );
  }
  return paths.remoteBranch;
}

// A brand-new workspace has no commit yet: start its history from the pull.
async function adopt(root: string, branch: string): Promise<IntegrationResult> {
  await runGitOrThrow(["reset", "-q", branch], root);
  await runGitOrThrow(["checkout", "-q", "--", "."], root);
  const commit = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
  const files = lines(await runGitOrThrow(["ls-tree", "-r", "--name-only", "HEAD"], root));
  return { commit, changedFiles: files.length };
}

async function merge(
  root: string,
  instance: string,
  branch: string,
  before: string,
): Promise<IntegrationResult> {
  const related = (await runGit(["merge-base", "HEAD", branch], root)).exitCode === 0;
  const configured = (await runGit(["config", "user.email"], root)).stdout.trim() !== "";
  const args = [
    ...(configured ? [] : FALLBACK_IDENTITY),
    ...["merge", "--no-ff", "--no-edit", "-m", `snagentic integrate ${instance}`],
    ...(related ? [] : ["--allow-unrelated-histories"]),
    branch,
  ];
  if ((await runGit(args, root)).exitCode !== 0) {
    const conflicts = lines(await runGitOrThrow(["diff", "--name-only", "--diff-filter=U"], root));
    throw new IntegrationBlockedError(
      "integration-conflicts",
      `${conflicts.length} file(s) changed both locally and on the instance: ${conflicts.slice(0, 5).join(", ")}`,
      "resolve the conflict markers, then run: git commit",
    );
  }
  const commit = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
  const changed = lines(await runGitOrThrow(["diff", "--name-only", before, commit], root));
  return { commit, changedFiles: changed.length };
}

// `integrate` (ADR-0007): git's three-way merge reconciles remote changes with local work.
async function integrate(root: string, instance: string): Promise<IntegrationResult> {
  const branch = await ensureIntegrable(root, instance);
  const head = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], root);
  if (head.exitCode !== 0) {
    return adopt(root, branch);
  }
  if ((await runGit(["merge-base", "--is-ancestor", branch, "HEAD"], root)).exitCode === 0) {
    return { commit: null, changedFiles: 0 };
  }
  return merge(root, instance, branch, head.stdout.trim());
}

export const gitIntegrator: MirrorIntegrator = { integrate };
