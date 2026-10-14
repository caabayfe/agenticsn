import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InstanceName,
  instancePaths,
  type MaterializedFile,
  type PackWorkspace,
  type PatchTarget,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings, toYaml } from "../yaml/own-style";

// Pack commits are snagentic's, as mirror commits are (ADR-0007).
const IDENTITY = {
  GIT_AUTHOR_NAME: "snagentic",
  GIT_AUTHOR_EMAIL: "snagentic@localhost",
  GIT_COMMITTER_NAME: "snagentic",
  GIT_COMMITTER_EMAIL: "snagentic@localhost",
};

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

const record = (text: string): Readonly<Record<string, unknown>> => {
  const parsed = fromYamlStrings(text);
  return parsed !== null && typeof parsed === "object"
    ? Object.fromEntries(Object.entries(parsed))
    : {};
};

// One instance's pack branches in a workspace (ADR-0026, item 2): accelerator/<pack>/<instance>,
// built with plumbing on the instance's mirror, merged into the working branch.
export class GitPackWorkspace implements PackWorkspace {
  private readonly metadata: string;
  private readonly remote: string;

  constructor(
    private readonly root: string,
    private readonly instance: string,
  ) {
    const paths = instancePaths(InstanceName.parse(instance));
    this.metadata = paths.metadata;
    this.remote = paths.remoteBranch;
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

  async mirrored(
    commit: string,
    sysIds: readonly string[],
  ): Promise<ReadonlyMap<string, PatchTarget>> {
    const found = new Map<string, PatchTarget>();
    if (sysIds.length === 0) return found;
    const listing = await runGitOrThrow(
      ["ls-tree", "-r", "--name-only", commit, "--", this.metadata],
      this.root,
    );
    for (const path of listing.split("\n")) {
      const sysId = sysIds.find((id) => path.endsWith(`--${id}.yaml`));
      if (sysId === undefined || found.has(sysId)) continue;
      const text = await runGitOrThrow(["show", `${commit}:${path}`], this.root);
      found.set(sysId, { path: path.slice(this.metadata.length + 1), document: record(text) });
    }
    return found;
  }

  parse(text: string): unknown {
    return fromYamlStrings(text);
  }

  async commit(pack: string, mirror: string, files: readonly MaterializedFile[], message: string) {
    const scratch = await mkdtemp(join(tmpdir(), "snagentic-pack-"));
    const env = { GIT_INDEX_FILE: join(scratch, "index") };
    try {
      await git(this.root, ["read-tree", mirror], env);
      for (const file of files) {
        const content = file.kind === "copy" ? file.text : toYaml(file.document);
        const blob = await git(this.root, ["hash-object", "-w", "--stdin"], env, content);
        const path = `${this.metadata}/${file.path}`;
        await git(
          this.root,
          ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`],
          env,
        );
      }
      const tree = await git(this.root, ["write-tree"], env);
      const branch = `refs/heads/${this.branch(pack)}`;
      const previous = await runGit(["rev-parse", "--verify", "--quiet", branch], this.root);
      const head = previous.exitCode === 0 ? previous.stdout.trim() : null;
      if (head !== null && (await git(this.root, ["rev-parse", `${head}^{tree}`], {})) === tree) {
        return head;
      }
      const parents = [...(head === null ? [] : ["-p", head]), "-p", mirror];
      const commit = await git(
        this.root,
        ["commit-tree", tree, ...parents, "-m", message],
        IDENTITY,
      );
      await git(this.root, ["update-ref", branch, commit], {});
      return commit;
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
