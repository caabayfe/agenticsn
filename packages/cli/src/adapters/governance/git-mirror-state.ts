import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MirrorState } from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { fromYamlStrings } from "../yaml/own-style";

const lines = (text: string) => text.split("\n").filter(Boolean);

function strings(value: unknown): Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, item]) =>
          typeof item === "string" ? [[key, item]] : [],
        ),
      )
    : {};
}

// One instance's mirror (`root` is instances/<name>/metadata) as validate sees it (ADR-0031
// item 2). Staged, it reads the index: what a commit would record, for the pre-commit hook.
export class GitMirrorState implements MirrorState {
  private readonly staged: boolean;

  constructor(
    private readonly workspace: string,
    private readonly root: string,
    private readonly mirrorBranch: string,
    options: { readonly staged?: boolean } = {},
  ) {
    this.staged = options.staged === true;
  }

  async resolve(ref: string): Promise<string | null> {
    const result = await runGit(
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      this.workspace,
    );
    return result.exitCode === 0 ? result.stdout.trim() : null;
  }

  // The instance's copy the workspace should hold: the one an integrate is merging, or else the
  // last one the branch integrated. Null before the first integrate.
  private async integrated(): Promise<string | null> {
    const merging = await this.resolve("MERGE_HEAD");
    if (merging !== null && merging === (await this.resolve(this.mirrorBranch))) return merging;
    const base = await runGit(["merge-base", "HEAD", this.mirrorBranch], this.workspace);
    return base.exitCode === 0 ? base.stdout.trim() : null;
  }

  async edited(): Promise<readonly string[]> {
    const base = await this.integrated();
    if (base === null) return [];
    const index = this.staged ? ["--cached"] : [];
    const changed = await runGitOrThrow(
      ["diff", ...index, "--name-only", "--no-renames", base, "--", this.root],
      this.workspace,
    );
    const added = this.staged
      ? ""
      : await runGitOrThrow(
          ["ls-files", "--others", "--exclude-standard", "--", this.root],
          this.workspace,
        );
    return [...new Set([...lines(changed), ...lines(added)])].sort();
  }

  private async text(path: string): Promise<string | null> {
    if (!this.staged) return readFile(join(this.workspace, path), "utf8").catch(() => null);
    const shown = await runGit(["show", `:${path}`], this.workspace);
    return shown.exitCode === 0 ? shown.stdout : null;
  }

  // Privileges are not domain-separated, so they sit in the scope's own folder. A new one may
  // leave out status, which the platform then sets to allowed.
  async privileges(scope: string): Promise<readonly string[]> {
    const folder = `${this.root}/${scope}/sys_scope_privilege`;
    const names = this.staged
      ? lines(await runGitOrThrow(["ls-files", "--", `${folder}/`], this.workspace)).map((path) =>
          path.slice(path.lastIndexOf("/") + 1),
        )
      : await readdir(join(this.workspace, folder)).catch(() => []);
    const declared: string[] = [];
    for (const name of names.filter((n) => n.endsWith(".yaml") && n.split(".").length === 2)) {
      const fields = strings(fromYamlStrings((await this.text(`${folder}/${name}`)) ?? ""));
      if ((fields["status"] ?? "allowed") === "allowed" && fields["target_name"] !== undefined) {
        declared.push(`${fields["target_type"] ?? ""}:${fields["target_name"]}`);
      }
    }
    return declared;
  }
}
