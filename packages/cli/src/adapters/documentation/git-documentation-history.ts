import type { DocumentationHistory, PageSource } from "@snagentic/core";
import { runGit } from "../git/run-git";
import { markdownSource } from "./fs-documentation-sources";

const FOLDER = "documentation";

// The workspace's documentation/ in its git history (ADR-0039). Paths are relative to
// documentation/, and the workspace may be a folder inside the repository.
export class GitDocumentationHistory implements DocumentationHistory {
  constructor(private readonly workspace: string) {}

  async changedSince(commit: string): Promise<readonly string[]> {
    const result = await runGit(
      ["diff", "--name-only", "--relative", commit, "--", FOLDER],
      this.workspace,
    );
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith(`${FOLDER}/`))
      .map((line) => line.slice(FOLDER.length + 1));
  }

  async at(commit: string, paths: readonly string[]): Promise<readonly PageSource[]> {
    const files: PageSource[] = [];
    for (const path of paths) {
      const shown = await runGit(["show", `${commit}:./${FOLDER}/${path}`], this.workspace);
      if (shown.exitCode === 0) files.push(markdownSource(path, shown.stdout));
    }
    return files;
  }
}
