import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FLUENT_KEYS_FILE,
  FLUENT_SOURCE_DIR,
  type FluentBuild,
  type FluentProject,
  type FluentProjects,
} from "@snagentic/core";
import { runGitOrThrow } from "../git/run-git";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";

const lines = (text: string) => text.split("\n").filter(Boolean);
// Build output and installed dependencies are never part of a project's source.
const NOT_SOURCE = new Set(["node_modules", "dist", ".now"]);
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
export class WorkspaceFluentProjects implements FluentProjects {
  constructor(
    private readonly workspace: string,
    private readonly load: LoadFluentRuntime,
  ) {}

  async changedSince(commit: string): Promise<readonly FluentProject[]> {
    const changed = await runGitOrThrow(
      ["diff", "--name-only", "--no-renames", commit, "--", FLUENT_SOURCE_DIR],
      this.workspace,
    );
    const added = await runGitOrThrow(
      ["ls-files", "--others", "--exclude-standard", "--", FLUENT_SOURCE_DIR],
      this.workspace,
    );
    return this.holding([...lines(changed), ...lines(added)]);
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
    const runtime = await this.load();
    const source = join(this.workspace, project.path);
    const copy = join(await mkdtemp(join(tmpdir(), "snagentic-fluent-")), "project");
    try {
      await cp(source, copy, {
        recursive: true,
        filter: (path) => !NOT_SOURCE.has(path.slice(source.length + 1).split(/[\\/]/)[0] ?? ""),
      });
      const outcome = await runtime.build(copy);
      if (!outcome.success) return { built: false, errors: outcome.errors };
      const before = await readText(join(source, FLUENT_KEYS_FILE));
      const after = await readText(join(copy, FLUENT_KEYS_FILE));
      return {
        built: true,
        keysChanged: before !== after,
        deletes: await deletesIn(join(copy, "dist", "app")),
      };
    } finally {
      await rm(join(copy, ".."), { recursive: true, force: true });
    }
  }

  async sdkVersion(): Promise<string> {
    return (await this.load()).sdkVersion;
  }
}
