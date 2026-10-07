import {
  InstanceName,
  type IntegrationResult,
  instanceConfirms,
  instancePaths,
  type MirrorIntegrator,
  NothingPulledError,
  SnagenticError,
} from "@snagentic/core";
import { fromYamlStrings } from "../yaml/own-style";
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
  return { commit, changedFiles: files.length, confirmed: [] };
}

// Files both sides added (index stages 2 and 3, no common ancestor), among the conflicts.
async function addedOnBothSides(root: string): Promise<{ added: string[]; conflicted: string[] }> {
  const stages = new Map<string, Set<string>>();
  for (const line of lines(await runGitOrThrow(["ls-files", "-u"], root))) {
    const [info = "", path = ""] = line.split("\t");
    const stage = info.split(" ")[2] ?? "";
    stages.set(path, (stages.get(path) ?? new Set()).add(stage));
  }
  const conflicted = [...stages.keys()];
  const added = conflicted.filter((path) => {
    const s = stages.get(path);
    return s?.has("2") === true && s.has("3") && !s.has("1");
  });
  return { added, conflicted };
}

// A record created here and pushed comes back from the instance with what the platform fills
// in. When the instance's copy confirms the local one (instanceConfirms) and none of the
// record's other files conflict, take it: nothing local is lost.
async function takeConfirmed(root: string, metadata: string): Promise<string[]> {
  const { added, conflicted } = await addedOnBothSides(root);
  const confirmed: string[] = [];
  for (const path of added) {
    const base = path.slice(0, -".yaml".length);
    const own = path.startsWith(`${metadata}/`) && path.endsWith(".yaml");
    const others = conflicted.some((other) => other !== path && other.startsWith(`${base}.`));
    if (!own || path.includes(".children.") || others) {
      continue;
    }
    const mine = fromYamlStrings(await runGitOrThrow(["show", `:2:${path}`], root));
    const theirs = fromYamlStrings(await runGitOrThrow(["show", `:3:${path}`], root));
    if (instanceConfirms(mine, theirs)) {
      await runGitOrThrow(["checkout", "--theirs", "--", path], root);
      await runGitOrThrow(["add", "--", path], root);
      confirmed.push(path);
    }
  }
  return confirmed;
}

async function merge(
  root: string,
  instance: string,
  branch: string,
  before: string,
): Promise<IntegrationResult> {
  const related = (await runGit(["merge-base", "HEAD", branch], root)).exitCode === 0;
  const configured = (await runGit(["config", "user.email"], root)).stdout.trim() !== "";
  const identity = configured ? [] : FALLBACK_IDENTITY;
  const args = [
    ...identity,
    ...["merge", "--no-ff", "--no-edit", "-m", `snagentic integrate ${instance}`],
    ...(related ? [] : ["--allow-unrelated-histories"]),
    branch,
  ];
  let confirmed: string[] = [];
  if ((await runGit(args, root)).exitCode !== 0) {
    confirmed = await takeConfirmed(root, instancePaths(InstanceName.parse(instance)).metadata);
    const conflicts = lines(await runGitOrThrow(["diff", "--name-only", "--diff-filter=U"], root));
    if (conflicts.length > 0) {
      const taken =
        confirmed.length === 0
          ? ""
          : `; took the instance's copy of ${confirmed.length} record(s) pushed from here`;
      throw new IntegrationBlockedError(
        "integration-conflicts",
        `${conflicts.length} file(s) changed both locally and on the instance: ${conflicts.slice(0, 5).join(", ")}${taken}`,
        "resolve the conflict markers, then run: git commit",
      );
    }
    await runGitOrThrow([...identity, "commit", "-q", "--no-edit"], root);
  }
  const commit = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
  const changed = lines(await runGitOrThrow(["diff", "--name-only", before, commit], root));
  return { commit, changedFiles: changed.length, confirmed };
}

// `integrate` (ADR-0007): git's three-way merge reconciles remote changes with local work.
async function integrate(root: string, instance: string): Promise<IntegrationResult> {
  const branch = await ensureIntegrable(root, instance);
  const head = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], root);
  if (head.exitCode !== 0) {
    return adopt(root, branch);
  }
  if ((await runGit(["merge-base", "--is-ancestor", branch, "HEAD"], root)).exitCode === 0) {
    return { commit: null, changedFiles: 0, confirmed: [] };
  }
  return merge(root, instance, branch, head.stdout.trim());
}

export const gitIntegrator: MirrorIntegrator = { integrate };
