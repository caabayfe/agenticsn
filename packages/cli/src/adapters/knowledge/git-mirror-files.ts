import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CodeHit, GrepOptions, MirrorFiles } from "@snagentic/core";
import { gitLines, runGit, runGitOrThrow } from "../git/run-git";
import { scanRecord } from "../yaml/record-scan";

const lines = (text: string) => text.split("\n").filter(Boolean);

// First index in a sorted list whose entry is not below `value`.
function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? "") < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

// One instance's metadata in the workspace (`root` is instances/<name>/metadata): what git
// knows about it and what is on disk now, which is what the agent sees.
export class GitMirrorFiles implements MirrorFiles {
  private readonly listings = new Map<string, Promise<string[]>>();

  constructor(
    private readonly workspace: string,
    private readonly root: string,
  ) {}

  private relative(path: string): string {
    return path.slice(this.root.length + 1);
  }

  async head(): Promise<string | null> {
    const result = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], this.workspace);
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async changes(commit: string | null) {
    const committed =
      commit === null
        ? await runGitOrThrow(["ls-files", "--", this.root], this.workspace)
        : await runGitOrThrow(
            ["diff", "--name-only", "--no-renames", commit, "HEAD", "--", this.root],
            this.workspace,
          );
    const edited = await runGitOrThrow(
      ["diff", "--name-only", "--no-renames", "HEAD", "--", this.root],
      this.workspace,
    );
    const added = await runGitOrThrow(
      ["ls-files", "--others", "--exclude-standard", "--", this.root],
      this.workspace,
    );
    return {
      committed: lines(committed).map((path) => this.relative(path)),
      dirty: [...new Set([...lines(edited), ...lines(added)])]
        .map((path) => this.relative(path))
        .sort(),
    };
  }

  async readDocument(base: string) {
    const files = await this.filesOf(base);
    const texts = await Promise.all(
      files.map((file) => readFile(join(this.workspace, this.root, file), "utf8").catch(() => "")),
    );
    const yaml = files.indexOf(`${base}.yaml`);
    const record = yaml < 0 ? null : scanRecord(texts[yaml] ?? "");
    return { record, text: texts.join("\n") };
  }

  // A record's files, from its folder's listing. Each folder is listed once per session:
  // some hold well over 100,000 files.
  async filesOf(base: string): Promise<string[]> {
    const directory = dirname(base);
    const prefix = `${base.slice(directory.length + 1)}.`;
    const names = await this.listing(directory);
    let index = lowerBound(names, prefix);
    const files: string[] = [];
    while (index < names.length && (names[index] ?? "").startsWith(prefix)) {
      files.push(`${directory}/${names[index]}`);
      index += 1;
    }
    return files;
  }

  private listing(directory: string): Promise<string[]> {
    const cached = this.listings.get(directory);
    if (cached !== undefined) {
      return cached;
    }
    const listed = readdir(join(this.workspace, this.root, directory))
      .then((names) => names.sort())
      .catch(() => [] as string[]);
    this.listings.set(directory, listed);
    return listed;
  }

  // git grep over the files as they are now (tracked files, including local edits), all
  // texts in one pass over the files.
  async grep(texts: readonly string[], options: GrepOptions): Promise<CodeHit[]> {
    const hits: CodeHit[] = [];
    const limit = options.limit;
    const words = options.wholeWords === true ? ["-w"] : [];
    const patterns = texts.flatMap((text) => ["-e", text]);
    const where =
      options.bases === undefined
        ? [this.root]
        : options.bases.map((base) => `${this.root}/${base}.*`);
    const args = [
      "grep",
      "-n",
      "-I",
      "-F",
      ...words,
      "--full-name",
      "--no-color",
      ...patterns,
      "--",
      ...where,
    ];
    for await (const line of gitLines(args, this.workspace, [0, 1])) {
      const [path = "", number = "", ...rest] = line.split(":");
      hits.push({
        path: this.relative(path),
        line: Number(number),
        text: rest.join(":").trim().slice(0, 200),
      });
      if (hits.length >= limit) {
        break;
      }
    }
    return hits;
  }
}
