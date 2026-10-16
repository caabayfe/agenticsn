import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuiltUnit,
  DraftOutcome,
  FluentToolchain,
  SdkAccess,
  SourceProject,
  TransformTarget,
} from "@snagentic/core";
import { fromCommit, fromWorkingTree } from "./build-in-copy";
import { builtUnitOf } from "./built-units";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";

const NOT_SOURCE = new Set(["node_modules", "dist", ".now"]);

// Source files of a project folder, project-relative, with their content.
async function sourceFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name).slice(root.length + 1);
    if (NOT_SOURCE.has(path.split(/[\\/]/)[0] ?? "")) continue;
    files.set(path, await readFile(join(root, path), "utf8"));
  }
  return files;
}

// The units a build wrote under dist/app.
export async function unitsIn(project: string): Promise<BuiltUnit[]> {
  const output = join(project, "dist", "app");
  const names = await readdir(output, { recursive: true }).catch(() => []);
  const units: BuiltUnit[] = [];
  for (const name of names.filter((n) => n.endsWith(".xml")).sort()) {
    units.push(builtUnitOf(name, await readFile(join(output, name), "utf8")));
  }
  return units;
}

// The embedded SDK working on copies of the workspace's projects: the workspace is written
// only when a draft is applied.
export class SdkToolchain implements FluentToolchain {
  constructor(
    private readonly workspace: string,
    private readonly load: LoadFluentRuntime,
  ) {}

  async draftTransform(
    project: SourceProject,
    records: readonly TransformTarget[],
    access: SdkAccess,
    commit?: string,
  ): Promise<DraftOutcome> {
    const runtime = await this.load();
    const source = join(this.workspace, project.path);
    const scratch = await mkdtemp(join(tmpdir(), "snagentic-adopt-"));
    const copy = join(scratch, "project");
    try {
      const fill =
        commit === undefined
          ? fromWorkingTree(source)
          : fromCommit(this.workspace, project.path, commit);
      await fill(copy);
      const original = await sourceFiles(copy);
      const first = await runtime.build(copy);
      if (!first.success)
        return {
          ok: false,
          message: `the project does not build: ${first.errors[0]?.message ?? ""}`,
        };
      const before = await unitsIn(copy);
      const transformed = await runtime.transform(copy, records, access.host, access.exchange);
      if (!transformed.success) return { ok: false, message: transformed.message };
      const second = await runtime.build(copy);
      if (!second.success)
        return {
          ok: false,
          message: `the converted source does not build: ${second.errors[0]?.message ?? ""}`,
        };
      const after = await unitsIn(copy);
      const now = await sourceFiles(copy);
      const files = new Map([...now].filter(([path, text]) => original.get(path) !== text).sort());
      return { ok: true, draft: { before, after, files } };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
