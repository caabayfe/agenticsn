import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BranchNotPublishedError,
  type DeliveryWorkspace,
  FLUENT_SOURCE_DIR,
  type InstanceName,
  instancePaths,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";

// What plan and push need of git (ADR-0031): the mirror branch as validate's base, the branch,
// committed waivers, uncommitted source, and the ledger commit.
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

  async waivers(): Promise<{ committed: unknown | null; uncommitted: boolean }> {
    const working = await readFile(join(this.root, WAIVERS), "utf8").catch(() => null);
    const head = await runGit(["show", `HEAD:${WAIVERS}`], this.root);
    const committed = head.exitCode === 0 ? head.stdout : null;
    return {
      committed: committed === null ? null : fromYamlStrings(committed),
      uncommitted: working !== committed,
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
    await runGitOrThrow(["add", "--", ...paths], this.root);
    // A machine (or CI runner) with no git identity still records the ledger, as integrate does.
    const configured = (await runGit(["config", "user.email"], this.root)).stdout.trim() !== "";
    const identity = configured
      ? []
      : ["-c", "user.name=snagentic", "-c", "user.email=snagentic@localhost"];
    await runGitOrThrow(
      [...identity, "commit", "--quiet", "-m", message, "--", ...paths],
      this.root,
    );
    return (await runGitOrThrow(["rev-parse", "HEAD"], this.root)).trim();
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
