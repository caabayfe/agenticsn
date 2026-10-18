import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InstanceName,
  instancePaths,
  type MaterializedFile,
  type PackWorkspace,
  type PreviousAdd,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";

// Pack commits are snagentic's, as mirror commits are (ADR-0007).
const IDENTITY = {
  GIT_AUTHOR_NAME: "snagentic",
  GIT_AUTHOR_EMAIL: "snagentic@localhost",
  GIT_COMMITTER_NAME: "snagentic",
  GIT_COMMITTER_EMAIL: "snagentic@localhost",
};

const WRITTEN = "Pack-Written";
const KEPT = "Pack-Kept";

// git with extra environment and an optional stdin, for plumbing on a private index.
async function git(cwd: string, args: string[], env: Record<string, string>, input?: string) {
  const child = Bun.spawn(["git", ...args], {
    cwd,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args[0]} failed: ${err.trim()}`);
  return out.trim();
}

// One instance's pack branches in a workspace (ADR-0026, item 2): accelerator/<pack>/<instance>,
// built with plumbing on the instance's mirror, merged into the working branch. File paths are
// workspace-relative (source/<scope>/..., ADR-0031).
export class GitPackWorkspace implements PackWorkspace {
  private readonly remote: string;

  constructor(
    private readonly root: string,
    private readonly instance: string,
  ) {
    this.remote = instancePaths(InstanceName.parse(instance)).remoteBranch;
  }

  private branch(pack: string): string {
    return `accelerator/${pack}/${this.instance}`;
  }

  async mirrorCommit(): Promise<string | null> {
    const found = await runGit(
      ["rev-parse", "--verify", "--quiet", `${this.remote}^{commit}`],
      this.root,
    );
    return found.exitCode === 0 ? found.stdout.trim() : null;
  }

  async includes(commit: string): Promise<boolean> {
    return (
      (await runGit(["merge-base", "--is-ancestor", commit, "HEAD"], this.root)).exitCode === 0
    );
  }

  async present(paths: readonly string[]): Promise<readonly string[]> {
    if (paths.length === 0) return [];
    const listed = await runGitOrThrow(["ls-files", "--", ...paths], this.root);
    return listed.split("\n").filter(Boolean);
  }

  parse(text: string): unknown {
    return fromYamlStrings(text);
  }

  async previous(pack: string): Promise<PreviousAdd> {
    const head = await this.head(pack);
    const body = head === null ? "" : await git(this.root, ["log", "-1", "--format=%B", head], {});
    const trailer = (name: string) =>
      body
        .split("\n")
        .filter((line) => line.startsWith(`${name}: `))
        .map((line) => line.slice(name.length + 2));
    return { written: trailer(WRITTEN), kept: trailer(KEPT) };
  }

  async commit(
    pack: string,
    mirror: string,
    files: readonly MaterializedFile[],
    message: string,
    keep: readonly string[],
  ) {
    const head = await this.head(pack);
    const tree = await this.tree(mirror, files, head === null ? [] : keep.map((k) => [head, k]));
    if (head !== null && (await git(this.root, ["rev-parse", `${head}^{tree}`], {})) === tree) {
      return head;
    }
    // Trailers record what this add wrote and kept, for the next version's `previous`.
    const trailers = [
      ...files.map((f) => `${WRITTEN}: ${f.path}`).sort(),
      ...keep.map((k) => `${KEPT}: ${k}`),
    ];
    const parents = [...(head === null ? [] : ["-p", head]), "-p", mirror];
    const commit = await git(
      this.root,
      [
        "commit-tree",
        tree,
        ...parents,
        "-m",
        message,
        ...(trailers.length > 0 ? ["-m", trailers.join("\n")] : []),
      ],
      IDENTITY,
    );
    await git(this.root, ["update-ref", `refs/heads/${this.branch(pack)}`, commit], {});
    return commit;
  }

  private async head(pack: string): Promise<string | null> {
    const found = await runGit(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${this.branch(pack)}`],
      this.root,
    );
    return found.exitCode === 0 ? found.stdout.trim() : null;
  }

  // The mirror's tree with the files written and the kept paths as `[commit, path]` has them,
  // built on a private index so the user's index is never touched.
  private async tree(
    mirror: string,
    files: readonly MaterializedFile[],
    kept: readonly (readonly [string, string])[],
  ): Promise<string> {
    const scratch = await mkdtemp(join(tmpdir(), "snagentic-pack-"));
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    const stage = (blob: string, path: string) =>
      git(this.root, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], env);
    try {
      await git(this.root, ["read-tree", mirror], env);
      for (const file of files) {
        await stage(
          await git(this.root, ["hash-object", "-w", "--stdin"], env, file.text),
          file.path,
        );
      }
      for (const [commit, path] of kept) {
        const blob = await runGit(
          ["rev-parse", "--verify", "--quiet", `${commit}:${path}`],
          this.root,
        );
        if (blob.exitCode === 0) await stage(blob.stdout.trim(), path);
      }
      return await git(this.root, ["write-tree"], env);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  async merge(
    pack: string,
  ): Promise<{ readonly branch: string; readonly conflicts: readonly string[] }> {
    const branch = this.branch(pack);
    const merged = await runGit(["merge", "--no-edit", "--no-ff", branch], this.root);
    if (merged.exitCode === 0) return { branch, conflicts: [] };
    const unmerged = await runGitOrThrow(["diff", "--name-only", "--diff-filter=U"], this.root);
    const conflicts = unmerged.split("\n").filter(Boolean);
    if (conflicts.length === 0) {
      throw new Error(
        `git merge ${branch} failed: ${merged.stderr.trim() || merged.stdout.trim()}`,
      );
    }
    return { branch, conflicts };
  }
}
