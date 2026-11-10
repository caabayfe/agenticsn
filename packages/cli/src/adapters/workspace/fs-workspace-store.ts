import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  GITIGNORE,
  MANIFEST_FILE,
  type RepositorySetting,
  type WorkspaceManifest,
  type WorkspaceStore,
} from "@snagentic/core";
import { parse, stringify } from "yaml";
import { runGit, runGitOrThrow } from "../git/run-git";

type Setting = Pick<RepositorySetting, "key" | "value">;

// git settings for repositories with hundreds of thousands of files. git's built-in
// file-system monitor exists only on macOS and Windows. Deep mirror records pass Windows'
// 260-character path limit, which git keeps unless core.longpaths is set.
function largeRepositorySettings(platform: NodeJS.Platform): readonly Setting[] {
  const settings = [
    { key: "feature.manyFiles", value: "true" },
    { key: "core.untrackedCache", value: "true" },
  ];
  if (platform === "darwin") return [...settings, { key: "core.fsmonitor", value: "true" }];
  if (platform === "win32") {
    return [
      ...settings,
      { key: "core.fsmonitor", value: "true" },
      { key: "core.longpaths", value: "true" },
    ];
  }
  return settings;
}

function nearestExisting(directory: string): string {
  let current = resolve(directory);
  while (!existsSync(current) && dirname(current) !== current) {
    current = dirname(current);
  }
  return current;
}

export class FsWorkspaceStore implements WorkspaceStore {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

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
    return { layout: Reflect.get(data, "layout"), createdWith: Reflect.get(data, "created_with") };
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
    await this.tuneRepository(directory, largeRepositorySettings(this.platform));
    // The directory was empty: everything in it is the workspace's own (ADR-0014).
    await runGitOrThrow(["add", "-A"], directory);
    const configured = (await runGit(["config", "user.email"], directory)).stdout.trim() !== "";
    const identity = configured
      ? []
      : ["-c", "user.name=snagentic", "-c", "user.email=snagentic@localhost"];
    await runGitOrThrow([...identity, "commit", "-q", "-m", "snagentic init"], directory);
  }

  async repositoryTuning(directory: string): Promise<readonly RepositorySetting[] | null> {
    if (!(await this.isInsideGitRepository(directory))) {
      return null;
    }
    return Promise.all(
      largeRepositorySettings(this.platform).map(async (setting) => {
        // Exit code 1 means unset in every scope.
        const result = await runGit(["config", "--get", setting.key], directory);
        return { ...setting, current: result.exitCode === 0 ? result.stdout.trim() : null };
      }),
    );
  }

  async tuneRepository(directory: string, settings: readonly Setting[]): Promise<void> {
    for (const { key, value } of settings) {
      await runGitOrThrow(["config", "--local", key, value], directory);
    }
  }
}
