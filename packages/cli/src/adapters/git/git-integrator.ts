import {
  InstanceName,
  type IntegrationResult,
  instanceConfirms,
  instancePaths,
  type MirrorIntegrator,
  NothingPulledError,
  type RecordCopy,
  relocatedRecords,
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

// Reads records as committed at a revision. Class folders can hold over 100,000 files, so
// each folder is listed once per revision.
function recordReader(root: string) {
  const listings = new Map<string, Promise<string[]>>();
  const list = (rev: string, folder: string) => {
    const key = `${rev}:${folder}`;
    const listed =
      listings.get(key) ??
      runGitOrThrow(["ls-tree", "--name-only", rev, `${folder}/`], root).then(lines);
    listings.set(key, listed);
    return listed;
  };
  // A record's YAML and field files (<base>.<field>.<ext>).
  return async (rev: string, base: string): Promise<RecordCopy> => {
    const files: { field: string; content: string }[] = [];
    for (const path of await list(rev, base.slice(0, base.lastIndexOf("/")))) {
      const [field = "", extension, ...rest] = path.slice(base.length + 1).split(".");
      const own = path.startsWith(`${base}.`) && extension !== undefined && rest.length === 0;
      if (own && field !== "children" && extension !== "yaml") {
        files.push({ field, content: await runGitOrThrow(["show", `${rev}:${path}`], root) });
      }
    }
    const yaml = await runGit(["show", `${rev}:${base}.yaml`], root);
    return { document: yaml.exitCode === 0 ? fromYamlStrings(yaml.stdout) : null, files };
  };
}

type RecordReader = ReturnType<typeof recordReader>;

// A record created here and pushed comes back from the instance with what the platform fills
// in. When the instance's copy confirms the local one (instanceConfirms, scripts included),
// take all of its files: nothing local is lost.
async function takeConfirmed(
  root: string,
  read: RecordReader,
  where: { metadata: string; branch: string },
): Promise<string[]> {
  const { metadata, branch } = where;
  const { added, conflicted } = await addedOnBothSides(root);
  const confirmed: string[] = [];
  for (const path of added) {
    const base = path.slice(0, -".yaml".length);
    if (
      !path.startsWith(`${metadata}/`) ||
      !path.endsWith(".yaml") ||
      path.includes(".children.")
    ) {
      continue;
    }
    if (instanceConfirms(await read("HEAD", base), await read(branch, base))) {
      const own = conflicted.filter((other) => other === path || other.startsWith(`${base}.`));
      await runGitOrThrow(["checkout", "--theirs", "--", ...own], root);
      await runGitOrThrow(["add", "--", ...own], root);
      confirmed.push(path);
    }
  }
  return confirmed;
}

// Records created here that the pull brought back under the name the platform gave them (same
// folder and sys_id): the local files go when the instance's copy confirms them; otherwise
// both stay, and the user keeps one.
async function takeRelocated(
  root: string,
  read: RecordReader,
  where: { metadata: string; branch: string },
) {
  const { metadata, branch } = where;
  const fork = (await runGitOrThrow(["merge-base", "HEAD", branch], root)).trim();
  const added = async (rev: string) =>
    lines(
      await runGitOrThrow(
        ["diff", "--name-only", "--diff-filter=A", fork, rev, "--", metadata],
        root,
      ),
    )
      .filter((path) => path.endsWith(".yaml") && !path.includes(".children."))
      .map((path) => path.slice(metadata.length + 1, -".yaml".length));
  const confirmed: string[] = [];
  const unresolved: string[] = [];
  for (const { local, mirror } of relocatedRecords(await added("HEAD"), await added(branch))) {
    const [mine, theirs] = [`${metadata}/${local}`, `${metadata}/${mirror}`];
    if (instanceConfirms(await read("HEAD", mine), await read(branch, theirs))) {
      await runGitOrThrow(["rm", "-q", "--", `${mine}.yaml`, `${mine}.*`], root);
      confirmed.push(`${theirs}.yaml`);
    } else {
      unresolved.push(`${mine}.yaml and ${theirs}.yaml`);
    }
  }
  return { confirmed, unresolved };
}

function blocked(conflicts: readonly string[], unresolved: readonly string[], taken: number) {
  const parts = [
    ...(conflicts.length === 0
      ? []
      : [
          `${conflicts.length} file(s) changed both locally and on the instance: ${conflicts.slice(0, 5).join(", ")}`,
        ]),
    ...unresolved.map((pair) => `one record in two files that differ: ${pair}`),
  ];
  const note =
    taken === 0 ? "" : `; took the instance's copy of ${taken} record(s) pushed from here`;
  return new IntegrationBlockedError(
    "integration-conflicts",
    `${parts.join("; ")}${note}`,
    "resolve the conflict markers and keep one file per record, then run: git commit",
  );
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
    ...["merge", "--no-ff", "--no-commit", "-m", `snagentic integrate ${instance}`],
    ...(related ? [] : ["--allow-unrelated-histories"]),
    branch,
  ];
  const where = { metadata: instancePaths(InstanceName.parse(instance)).metadata, branch };
  const read = recordReader(root);
  const clean = (await runGit(args, root)).exitCode === 0;
  const pushed = clean ? [] : await takeConfirmed(root, read, where);
  const moved = related ? await takeRelocated(root, read, where) : NOTHING_MOVED;
  const confirmed = [...pushed, ...moved.confirmed];
  const conflicts = lines(await runGitOrThrow(["diff", "--name-only", "--diff-filter=U"], root));
  if (conflicts.length > 0 || moved.unresolved.length > 0) {
    throw blocked(conflicts, moved.unresolved, confirmed.length);
  }
  await runGitOrThrow([...identity, "commit", "-q", "--no-edit"], root);
  const commit = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
  const changed = lines(await runGitOrThrow(["diff", "--name-only", before, commit], root));
  return { commit, changedFiles: changed.length, confirmed };
}

const NOTHING_MOVED = { confirmed: [], unresolved: [] } as const;

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
