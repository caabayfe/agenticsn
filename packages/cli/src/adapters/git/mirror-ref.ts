import { SnagenticError } from "@snagentic/core";
import { childEnvironment } from "../child-environment";
import { runGit, runGitOrThrow } from "./run-git";

// Another pull committed the mirror branch after this one started: committing on top of it
// would drop that pull's commit, so this one stops.
export class MirrorMovedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "mirror-moved",
      "precondition",
      `another pull moved the mirror of ${instance} while this pull ran; nothing was committed`,
      `run snagentic pull ${instance} again: it continues from the mirror the other pull left`,
    );
  }
}

async function tipOf(repository: string, ref: string): Promise<string | null> {
  const result = await runGit(["rev-parse", "--verify", "--quiet", ref], repository);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

// Moves `ref` to `commit` only while it still points at `expected` (null: does not exist yet),
// as git checks and moves it in one step.
export async function moveMirrorBranch(
  repository: string,
  instance: string,
  move: { readonly ref: string; readonly commit: string; readonly expected: string | null },
): Promise<void> {
  const args = ["update-ref", move.ref, move.commit, move.expected ?? ""];
  const result = await runGit(args, repository);
  if (result.exitCode === 0) {
    return;
  }
  if ((await tipOf(repository, move.ref)) !== move.expected) {
    throw new MirrorMovedError(instance);
  }
  await runGitOrThrow(args, repository);
}

const IDENTITY = {
  GIT_AUTHOR_NAME: "snagentic",
  GIT_AUTHOR_EMAIL: "snagentic@localhost",
  GIT_COMMITTER_NAME: "snagentic",
  GIT_COMMITTER_EMAIL: "snagentic@localhost",
};

// A mirror commit of `tree`, made by snagentic whoever runs the pull.
export async function commitMirrorTree(
  repository: string,
  commit: { readonly tree: string; readonly parent: string | null; readonly message: string },
): Promise<string> {
  const { tree, parent, message } = commit;
  const args = ["commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-m", message];
  const child = Bun.spawn(["git", ...args], {
    cwd: repository,
    stdout: "pipe",
    stderr: "pipe",
    env: childEnvironment(IDENTITY),
  });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) {
    throw new Error(`git commit-tree failed: ${await new Response(child.stderr).text()}`);
  }
  return out.trim();
}
