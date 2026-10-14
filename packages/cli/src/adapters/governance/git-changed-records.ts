import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { baseOfFile, type ChangedRecords, type RecordVersion } from "@snagentic/core";
import { gitLines, runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
// Staged, it reads the index instead of the working tree: what a commit would record, for the
// pre-commit hook, so untracked files and unstaged edits are not part of the check.
export class GitChangedRecords implements ChangedRecords {
  private readonly staged: boolean;

  constructor(
    private readonly workspace: string,
    private readonly root: string,
    private readonly mirrorBranch: string,
    options: { readonly staged?: boolean } = {},
  ) {
    this.staged = options.staged === true;
  }

  async mirrorMerge(): Promise<string | null> {
    const merging = await this.resolve("MERGE_HEAD");
    return merging !== null && merging === (await this.resolve(this.mirrorBranch)) ? merging : null;
  }

  async resolve(ref: string): Promise<string | null> {
    const result = await runGit(
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      this.workspace,
    );
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  async changedSince(commit: string): Promise<string[]> {
    const index = this.staged ? ["--cached"] : [];
    const changed = await runGitOrThrow(
      ["diff", ...index, "--name-only", "--no-renames", commit, "--", this.root],
      this.workspace,
    );
    const added = this.staged
      ? ""
      : await runGitOrThrow(
          ["ls-files", "--others", "--exclude-standard", "--", this.root],
          this.workspace,
        );
    const paths = [...lines(changed), ...lines(added)].map((path) =>
      path.slice(this.root.length + 1),
    );
    return [...new Set(paths.map(baseOfFile))].sort();
  }

  async current(base: string): Promise<RecordVersion | null> {
    if (this.staged) {
      return this.indexed(base);
    }
    const names = await readdir(join(this.workspace, this.root, dirname(base))).catch(() => []);
    return this.version(base, scriptFiles(base, names), (path) =>
      readFile(join(this.workspace, this.root, path), "utf8").catch(() => null),
    );
  }

  // The record's files as staged.
  private async indexed(base: string): Promise<RecordVersion | null> {
    const folder = `${this.root}/${dirname(base)}`;
    const listed = lines(await runGitOrThrow(["ls-files", "--", `${folder}/`], this.workspace));
    const names = listed
      .map((path) => path.slice(folder.length + 1))
      .filter((n) => !n.includes("/"));
    return this.version(base, scriptFiles(base, names), async (path) => {
      const result = await runGit(["show", `:${this.root}/${path}`], this.workspace);
      return result.exitCode === 0 ? result.stdout : null;
    });
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

  // `git grep` for the field's line in the class folders: one process, whatever the number of
  // records (an instance has tens of thousands of ACL roles).
  async countReferences(
    className: string,
    field: string,
    sysId: string,
    commit: string | null,
  ): Promise<number> {
    const where = commit === null ? ["--untracked"] : [commit];
    let count = 0;
    for await (const line of gitLines(
      [
        "grep",
        "-l",
        "-E",
        "-e",
        // Plain, single- or double-quoted: agents write YAML their own way.
        `^${escaped(field)}: (${escaped(sysId)}|'${escaped(sysId)}'|"${escaped(sysId)}")$`,
        ...where,
        "--",
        `${this.root}/*/${className}/*.yaml`,
      ],
      this.workspace,
      [0, 1],
    )) {
      count += line === "" ? 0 : 1;
    }
    return count;
  }

  // Privileges are not domain-separated, so they sit in the scope's own folder. A new one an
  // agent writes may leave out status, which the platform then sets to allowed.
  async privileges(scope: string): Promise<readonly string[]> {
    const folder = `${scope}/sys_scope_privilege`;
    const names = this.staged
      ? lines(
          await runGitOrThrow(["ls-files", "--", `${this.root}/${folder}/`], this.workspace),
        ).map((path) => path.slice(path.lastIndexOf("/") + 1))
      : await readdir(join(this.workspace, this.root, folder)).catch(() => []);
    const declared: string[] = [];
    for (const name of names.filter((n) => n.endsWith(".yaml") && n.split(".").length === 2)) {
      const version = await this.current(`${folder}/${name.slice(0, -".yaml".length)}`);
      const fields = version?.fields ?? {};
      if ((fields["status"] ?? "allowed") === "allowed" && fields["target_name"] !== undefined) {
        declared.push(`${fields["target_type"] ?? ""}:${fields["target_name"]}`);
      }
    }
    return declared;
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
