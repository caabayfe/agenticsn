import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BranchNotPublishedError,
  type BranchWaivers,
  type DeliveryWorkspace,
  FLUENT_SOURCE_DIR,
  type InstanceName,
  instancePaths,
  type ReviewedWaivers,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";
import { readCommitIndex, reconcileCommitIndex } from "./commit-index";

// What plan and push need of git (ADR-0031): the mirror branch as validate's base, the branch,
// committed waivers, the reviewed branch's waivers (ADR-0058), uncommitted source, and the ledger
// commit.
const WAIVERS = "waivers.yaml";

export class GitDeliveryWorkspace implements DeliveryWorkspace {
  readonly metadataRoot: string;
  private readonly remoteBranch: string;

  constructor(
    private readonly root: string,
    instance: InstanceName,
  ) {
    const paths = instancePaths(instance);
    this.metadataRoot = paths.metadata;
    this.remoteBranch = paths.remoteBranch;
  }

  async mirrorCommit(): Promise<string | null> {
    const result = await runGit(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${this.remoteBranch}`],
      this.root,
    );
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async branch(): Promise<string> {
    const name = (await runGitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], this.root)).trim();
    return name === "HEAD"
      ? (await runGitOrThrow(["rev-parse", "--short", "HEAD"], this.root)).trim()
      : name;
  }

  async waivers(): Promise<BranchWaivers> {
    const working = await readFile(join(this.root, WAIVERS), "utf8").catch(() => null);
    const head = await runGit(["show", `HEAD:${WAIVERS}`], this.root);
    const committed = head.exitCode === 0 ? head.stdout : null;
    return {
      committed: committed === null ? null : fromYamlStrings(committed),
      uncommitted: working !== committed,
    };
  }

  // The remote's default branch is what the clone recorded as <remote>/HEAD: nothing is fetched.
  async reviewedWaivers(remote: string): Promise<ReviewedWaivers> {
    const prefix = `refs/remotes/${remote}/`;
    const head = await runGit(["symbolic-ref", "--quiet", `${prefix}HEAD`], this.root);
    const ref = head.stdout.trim();
    const known =
      head.exitCode === 0 &&
      ref.startsWith(prefix) &&
      (await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], this.root))
        .exitCode === 0;
    if (!known) return { kind: "unresolved", remote };
    const shown = await runGit(["show", `${ref}:${WAIVERS}`], this.root);
    return {
      kind: "found",
      branch: `${remote}/${ref.slice(prefix.length)}`,
      document: shown.exitCode === 0 ? fromYamlStrings(shown.stdout) : null,
    };
  }

  async uncommittedSource(): Promise<string[]> {
    const status = await runGitOrThrow(
      ["status", "--porcelain", "--untracked-files=all", "--", FLUENT_SOURCE_DIR],
      this.root,
    );
    return status
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3))
      .sort();
  }

  async commitFiles(paths: readonly string[], message: string): Promise<string> {
    const index = await readCommitIndex(this.root);
    await runGitOrThrow(["add", "--", ...paths], this.root);
    // Files already as committed (a resumed install writes the same ones again): nothing to commit.
    const staged = await runGit(["diff", "--cached", "--quiet", "--", ...paths], this.root);
    if (staged.exitCode === 0)
      return (await runGitOrThrow(["rev-parse", "HEAD"], this.root)).trim();
    const identity = await this.identity();
    await runGitOrThrow(
      [...identity, "commit", "--quiet", "-m", message, "--", ...paths],
      this.root,
    );
    const committed = (await runGitOrThrow(["rev-parse", "HEAD"], this.root)).trim();
    await reconcileCommitIndex(this.root, index, committed);
    return committed;
  }

  // Plumbing, as the mirror's commits are: the same tree on top of HEAD, so neither the index
  // nor the working tree (staged or unstaged work of the user's) is read or changed.
  async commitRecord(message: string): Promise<string> {
    const head = (await runGitOrThrow(["rev-parse", "HEAD"], this.root)).trim();
    const commit = (
      await runGitOrThrow(
        [...(await this.identity()), "commit-tree", `${head}^{tree}`, "-p", head, "-m", message],
        this.root,
      )
    ).trim();
    await runGitOrThrow(["update-ref", "-m", "snagentic: record", "HEAD", commit, head], this.root);
    return commit;
  }

  // A machine (or CI runner) with no git identity still records the ledger, as integrate does.
  private async identity(): Promise<string[]> {
    const configured = (await runGit(["config", "user.email"], this.root)).stdout.trim() !== "";
    return configured ? [] : ["-c", "user.name=snagentic", "-c", "user.email=snagentic@localhost"];
  }

  async publishBranch(branch: string): Promise<void> {
    const configured = await runGit(["config", "--get", `branch.${branch}.remote`], this.root);
    const remote = configured.exitCode === 0 ? configured.stdout.trim() : "origin";
    const pushed = await runGit(["push", "--quiet", "--set-upstream", remote, branch], this.root);
    if (pushed.exitCode !== 0) {
      const reason = pushed.stderr.trim().split("\n")[0] ?? "git push failed";
      throw new BranchNotPublishedError(branch, remote, reason);
    }
  }
}
