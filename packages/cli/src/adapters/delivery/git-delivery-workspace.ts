import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  BranchNotPublishedError,
  type DeliveryWorkspace,
  type InstanceName,
  instancePaths,
  type RecordFiles,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";

const lines = (text: string) => text.split("\n").filter(Boolean);

// A record's files among a folder's names: <leaf>.yaml and <leaf>.<field>.<ext> (child rows,
// <leaf>.children.<table>.yaml, are not the record's own fields).
function recordFiles(leaf: string, names: readonly string[]) {
  const fields: { field: string; name: string }[] = [];
  for (const name of names) {
    const [stem, field, extension, ...rest] = name.split(".");
    if (
      stem === leaf &&
      field !== undefined &&
      extension !== undefined &&
      rest.length === 0 &&
      field !== "children"
    ) {
      fields.push({ field, name });
    }
  }
  return fields;
}

// The workspace for one instance: its mirror branch and the working tree, read with git.
const WAIVERS = "waivers.yaml";

export class GitDeliveryWorkspace implements DeliveryWorkspace {
  readonly metadataRoot: string;
  private readonly remoteBranch: string;
  // Folder listings at a commit: some folders hold well over 10,000 files.
  private readonly listings = new Map<string, Promise<string[]>>();

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

  async includes(commit: string): Promise<boolean> {
    return (
      (await runGit(["merge-base", "--is-ancestor", commit, "HEAD"], this.root)).exitCode === 0
    );
  }

  async branch(): Promise<string> {
    const name = (await runGitOrThrow(["rev-parse", "--abbrev-ref", "HEAD"], this.root)).trim();
    return name === "HEAD"
      ? (await runGitOrThrow(["rev-parse", "--short", "HEAD"], this.root)).trim()
      : name;
  }

  async changedFiles(commit: string): Promise<string[]> {
    const changed = await runGitOrThrow(
      ["diff", "--name-only", "--no-renames", commit, "--", this.metadataRoot],
      this.root,
    );
    const added = await runGitOrThrow(
      ["ls-files", "--others", "--exclude-standard", "--", this.metadataRoot],
      this.root,
    );
    const prefix = this.metadataRoot.length + 1;
    return [...new Set([...lines(changed), ...lines(added)])]
      .map((path) => path.slice(prefix))
      .sort();
  }

  async read(base: string, at: string | null): Promise<RecordFiles | null> {
    const folder = dirname(base);
    const names = at === null ? await this.folderNow(folder) : await this.folderAt(at, folder);
    const leaf = base.slice(folder.length + 1);
    const yaml = await this.content(`${base}.yaml`, at);
    if (yaml === null) {
      return null;
    }
    const files: { field: string; content: string }[] = [];
    for (const { field, name } of recordFiles(leaf, names)) {
      const content = await this.content(`${folder}/${name}`, at);
      if (content !== null) {
        files.push({ field, content });
      }
    }
    return { document: fromYamlStrings(yaml), files };
  }

  async recordsIn(folder: string, at: string | null): Promise<string[]> {
    const names = at === null ? await this.folderNow(folder) : await this.folderAt(at, folder);
    return names
      .filter((name) => name.endsWith(".yaml") && !name.includes(".children."))
      .map((name) => `${folder}/${name.slice(0, -".yaml".length)}`);
  }

  async text(path: string): Promise<string | null> {
    return this.content(path, null);
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

  async uncommittedFiles(): Promise<string[]> {
    return this.changedFiles("HEAD");
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

  private async content(path: string, at: string | null): Promise<string | null> {
    if (at === null) {
      return readFile(join(this.root, this.metadataRoot, path), "utf8").catch(() => null);
    }
    const result = await runGit(["show", `${at}:${this.metadataRoot}/${path}`], this.root);
    return result.exitCode === 0 ? result.stdout : null;
  }

  private folderNow(folder: string): Promise<string[]> {
    return readdir(join(this.root, this.metadataRoot, folder)).catch(() => []);
  }

  private folderAt(commit: string, folder: string): Promise<string[]> {
    const key = `${commit}:${folder}`;
    const cached = this.listings.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const listed = runGit(
      ["ls-tree", "--name-only", `${commit}:${this.metadataRoot}/${folder}`],
      this.root,
    ).then((result) => (result.exitCode === 0 ? lines(result.stdout) : []));
    this.listings.set(key, listed);
    return listed;
  }
}
