import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { baseOfFile, type ChangedRecords, type RecordVersion } from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";

const lines = (text: string) => text.split("\n").filter(Boolean);

// A record's script fields among its files: <base>.<field>.js.
function scriptFiles(base: string, names: readonly string[]): Record<string, string> {
  const leaf = base.slice(base.lastIndexOf("/") + 1);
  const files: Record<string, string> = {};
  for (const name of names) {
    const [stem, field, extension, ...rest] = name.split(".");
    if (stem === leaf && field !== undefined && extension === "js" && rest.length === 0) {
      files[field] = `${dirname(base)}/${name}`;
    }
  }
  return files;
}

function strings(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          typeof item === "string" ? [[key, item]] : [],
        ),
      )
    : {};
}

// One instance's metadata (`root` is instances/<name>/metadata) in the workspace and in git.
export class GitChangedRecords implements ChangedRecords {
  constructor(
    private readonly workspace: string,
    private readonly root: string,
  ) {}

  async resolve(ref: string): Promise<string | null> {
    const result = await runGit(
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      this.workspace,
    );
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async changedSince(commit: string): Promise<string[]> {
    const changed = await runGitOrThrow(
      ["diff", "--name-only", "--no-renames", commit, "--", this.root],
      this.workspace,
    );
    const added = await runGitOrThrow(
      ["ls-files", "--others", "--exclude-standard", "--", this.root],
      this.workspace,
    );
    const paths = [...lines(changed), ...lines(added)].map((path) =>
      path.slice(this.root.length + 1),
    );
    return [...new Set(paths.map(baseOfFile))].sort();
  }

  async current(base: string): Promise<RecordVersion | null> {
    const names = await readdir(join(this.workspace, this.root, dirname(base))).catch(() => []);
    return this.version(base, scriptFiles(base, names), (path) =>
      readFile(join(this.workspace, this.root, path), "utf8").catch(() => null),
    );
  }

  // The record's files at a commit. Only fields that still have a file are read: a script
  // that was removed has nothing left to report.
  async at(commit: string, base: string): Promise<RecordVersion | null> {
    const names = await readdir(join(this.workspace, this.root, dirname(base))).catch(() => []);
    return this.version(base, scriptFiles(base, names), async (path) => {
      const result = await runGit(["show", `${commit}:${this.root}/${path}`], this.workspace);
      return result.exitCode === 0 ? result.stdout : null;
    });
  }

  private async version(
    base: string,
    files: Record<string, string>,
    read: (path: string) => Promise<string | null>,
  ): Promise<RecordVersion | null> {
    const yaml = await read(`${base}.yaml`);
    if (yaml === null) {
      return null;
    }
    const parsed = fromYamlStrings(yaml);
    const meta = strings(
      typeof parsed === "object" && parsed !== null && "_meta" in parsed ? parsed._meta : null,
    );
    const fields = strings(parsed);
    const present: Record<string, string> = {};
    for (const [field, path] of Object.entries(files)) {
      const text = await read(path);
      if (text !== null) {
        fields[field] = text;
        present[field] = path;
      }
    }
    return {
      className: meta["sys_class_name"] ?? "",
      scope: meta["scope"] ?? "global",
      fields,
      files: present,
    };
  }
}
