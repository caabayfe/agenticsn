import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  GITIGNORE,
  MANIFEST_FILE,
  type WorkspaceManifest,
  type WorkspaceStore,
} from "@snagentic/core";
import { parse, stringify } from "yaml";
import { runGit, runGitOrThrow } from "../git/run-git";

// git settings for repositories with hundreds of thousands of files.
const LARGE_REPOSITORY_SETTINGS: readonly (readonly [string, string])[] = [
  ["feature.manyFiles", "true"],
  ["core.untrackedCache", "true"],
];

function nearestExisting(directory: string): string {
  let current = resolve(directory);
  while (!existsSync(current) && dirname(current) !== current) {
    current = dirname(current);
  }
  return current;
}

export class FsWorkspaceStore implements WorkspaceStore {
  ancestorsOf(directory: string): readonly string[] {
    const ancestors = [resolve(directory)];
    let current = ancestors[0] ?? "/";
    while (dirname(current) !== current) {
      current = dirname(current);
      ancestors.push(current);
    }
    return ancestors;
  }

  async readManifest(directory: string): Promise<unknown | null> {
    const path = join(directory, MANIFEST_FILE);
    if (!existsSync(path)) {
      return null;
    }
    const data: unknown = parse(await readFile(path, "utf8"));
    if (data === null || typeof data !== "object") {
      return {};
    }
    const fields = data as Record<string, unknown>;
    return { layout: fields["layout"], createdWith: fields["created_with"] };
  }

  async isInsideGitRepository(directory: string): Promise<boolean> {
    const result = await runGit(["rev-parse", "--is-inside-work-tree"], nearestExisting(directory));
    return result.exitCode === 0 && result.stdout.trim() === "true";
  }

  async isEmptyOrMissing(directory: string): Promise<boolean> {
    return !existsSync(directory) || (await readdir(directory)).length === 0;
  }

  async create(directory: string, manifest: WorkspaceManifest): Promise<void> {
    await mkdir(join(directory, "instances"), { recursive: true });
    const file = { created_with: manifest.createdWith, layout: manifest.layout };
    await writeFile(join(directory, MANIFEST_FILE), stringify(file, { sortMapEntries: true }));
    await writeFile(join(directory, ".gitignore"), GITIGNORE);
    await runGitOrThrow(["init", "-q", "-b", "main"], directory);
    for (const [key, value] of LARGE_REPOSITORY_SETTINGS) {
      await runGitOrThrow(["config", key, value], directory);
    }
    if (process.platform === "darwin" || process.platform === "win32") {
      await runGitOrThrow(["config", "core.fsmonitor", "true"], directory);
    }
  }
}
