import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CodeHit, MirrorFiles, RecordFields } from "@snagentic/core";
import { gitLines, runGit, runGitOrThrow } from "../git/run-git";
import { scanRecord } from "../yaml/record-scan";

const lines = (text: string) => text.split("\n").filter(Boolean);

// One instance's metadata in the workspace (`root` is instances/<name>/metadata): what git
// knows about it and what is on disk now, which is what the agent sees.
export class GitMirrorFiles implements MirrorFiles {
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
      dirty: [...new Set([...lines(edited), ...lines(added)])].map((path) => this.relative(path)),
    };
  }

  async readRecord(path: string): Promise<RecordFields | null> {
    try {
      return scanRecord(await readFile(join(this.workspace, this.root, path), "utf8"));
    } catch {
      return null;
    }
  }

  async filesOf(base: string): Promise<string[]> {
    const directory = dirname(base);
    const leaf = base.slice(directory.length + 1);
    const names = await readdir(join(this.workspace, this.root, directory)).catch(
      () => [] as string[],
    );
    return names
      .filter((name) => name.startsWith(`${leaf}.`))
      .sort()
      .map((name) => `${directory}/${name}`);
  }

  // git grep over the files as they are now (tracked files, including local edits).
  async grep(text: string, limit: number): Promise<CodeHit[]> {
    const hits: CodeHit[] = [];
    const args = [
      "grep",
      "-n",
      "-I",
      "-F",
      "--full-name",
      "--no-color",
      "-e",
      text,
      "--",
      this.root,
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
