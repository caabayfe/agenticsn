import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  FLUENT_KEYS_FILE,
  FLUENT_SOURCE_DIR,
  type FluentBuild,
  FluentKeysUnstagedError,
  type FluentProject,
  type FluentProjects,
} from "@snagentic/core";
import { runGit, runGitOrThrow } from "../git/run-git";
import { buildInCopy, fromIndex, fromWorkingTree } from "./build-in-copy";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";

const lines = (text: string) => text.split("\n").filter(Boolean);
const DELETE_RECORD = /action="DELETE"[\s\S]*?<sys_update_name>([^<]+)<\/sys_update_name>/;

const readText = (path: string) => readFile(path, "utf8").catch(() => null);

function declaredSdk(packageJson: string | null): string | null {
  if (packageJson === null) return null;
  const manifest: unknown = JSON.parse(packageJson);
  if (typeof manifest !== "object" || manifest === null) return null;
  for (const field of ["devDependencies", "dependencies"]) {
    const deps: unknown = field in manifest ? Reflect.get(manifest, field) : undefined;
    const version: unknown =
      typeof deps === "object" && deps !== null ? Reflect.get(deps, "@servicenow/sdk") : undefined;
    if (typeof version === "string") return version.replace(/^[\^~=v]+/, "");
  }
  return null;
}

// Update names of the delete records a build wrote.
async function deletesIn(directory: string): Promise<string[]> {
  const files = await readdir(directory, { recursive: true }).catch(() => []);
  const names: string[] = [];
  for (const file of files.filter((f) => f.endsWith(".xml")).sort()) {
    const match = DELETE_RECORD.exec((await readText(join(directory, file))) ?? "");
    if (match?.[1] !== undefined) names.push(match[1]);
  }
  return names;
}

// The workspace's Fluent projects under source/<scope>/, built with the embedded SDK in a
// temporary copy so validate and plan never write to the workspace (ADR-0028 as amended).
// Staged: the projects as the index holds them, for the pre-commit hook.
export class WorkspaceFluentProjects implements FluentProjects {
  private readonly staged: boolean;

  constructor(
    private readonly workspace: string,
    private readonly load: LoadFluentRuntime,
    options: { readonly staged?: boolean } = {},
  ) {
    this.staged = options.staged === true;
  }

  async changedSince(commit: string): Promise<readonly FluentProject[]> {
    const index = this.staged ? ["--cached"] : [];
    const changed = await runGitOrThrow(
      ["diff", ...index, "--name-only", "--no-renames", commit, "--", FLUENT_SOURCE_DIR],
      this.workspace,
    );
    const added = this.staged
      ? ""
      : await runGitOrThrow(
          ["ls-files", "--others", "--exclude-standard", "--", FLUENT_SOURCE_DIR],
          this.workspace,
        );
    return this.holding([...lines(changed), ...lines(added)]);
  }

  // keys.ts as the projects are read: from the index when staged.
  private async committedKeys(project: FluentProject): Promise<string | null> {
    const path = `${project.path}/${FLUENT_KEYS_FILE}`;
    if (!this.staged) return readText(join(this.workspace, path));
    const shown = await runGit(["show", `:${path}`], this.workspace);
    return shown.exitCode === 0 ? shown.stdout : null;
  }

  async holding(paths: readonly string[]): Promise<readonly FluentProject[]> {
    const folders = new Set<string>();
    for (const path of paths) {
      const [top, scope] = path.split("/");
      if (top === FLUENT_SOURCE_DIR && scope !== undefined && scope !== "") {
        folders.add(`${top}/${scope}`);
      }
    }
    const projects: FluentProject[] = [];
    for (const path of [...folders].sort()) {
      if ((await readText(join(this.workspace, path, "now.config.json"))) === null) continue;
      const packageJson = await readText(join(this.workspace, path, "package.json"));
      projects.push({ path, declaredSdk: declaredSdk(packageJson) });
    }
    return projects;
  }

  async build(project: FluentProject): Promise<FluentBuild> {
    const fill = this.staged
      ? fromIndex(this.workspace, project.path)
      : fromWorkingTree(join(this.workspace, project.path));
    const committed = await this.committedKeys(project);
    return buildInCopy(this.load, fill, async (copy, outcome) => {
      if (!outcome.success) return { built: false, errors: outcome.errors };
      const built = await readText(join(copy, FLUENT_KEYS_FILE));
      return {
        built: true,
        keys: built === null || built === committed ? null : { committed, built },
        deletes: await deletesIn(join(copy, "dist", "app")),
      };
    });
  }

  async writeKeys(project: FluentProject, keys: string): Promise<void> {
    const path = `${project.path}/${FLUENT_KEYS_FILE}`;
    const file = join(this.workspace, path);
    // Staged, the keys were built from the index: they replace the working tree's only when
    // it holds what the index holds, so no unstaged edit is lost.
    if (this.staged && (await readText(file)) !== (await this.committedKeys(project))) {
      throw new FluentKeysUnstagedError(path);
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, keys);
    if (this.staged) await runGitOrThrow(["add", "--", path], this.workspace);
  }

  async sdkVersion(): Promise<string> {
    return (await this.load()).sdkVersion;
  }
}
