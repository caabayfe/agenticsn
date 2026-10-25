import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuildOutcome,
  BuiltUnit,
  DraftOutcome,
  FluentToolchain,
  SdkAccess,
  SourceProject,
  TransformTarget,
} from "@snagentic/core";
import { fixConverted } from "@snagentic/core";
import { fromCommit, fromWorkingTree } from "./build-in-copy";
import { builtUnitOf, isEmptyUpdate } from "./built-units";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";
import type { FluentBuildError } from "./sdk-runtime";
import { sweepStaleScratch } from "./stale-scratch";

const NOT_SOURCE = new Set(["node_modules", "dist", ".now"]);
const SHOWN_ERRORS = 5;

// Every error the build reports, up to a few: the first is often a consequence of a later one
// (an unresolved data pill of a step whose id the SDK refused).
function buildErrors(errors: readonly FluentBuildError[]): string {
  if (errors.length === 0) return "the build failed";
  const shown = errors
    .slice(0, SHOWN_ERRORS)
    .map((e) => (e.file === "" ? e.message : `${e.file}:${e.line} ${e.message}`));
  const more = errors.length > SHOWN_ERRORS ? ` and ${errors.length - SHOWN_ERRORS} more` : "";
  return `${shown.join("; ")}${more}`;
}

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

// Fixes what the conversion wrote that the SDK's own types reject, in the files it changed
// (spec 009 X4). Returns why the conversion can't be adopted, if it can't.
async function fixConversion(root: string, original: ReadonlyMap<string, string>) {
  const refused: string[] = [];
  for (const [path, text] of await sourceFiles(root)) {
    if (!path.endsWith(".ts") || original.get(path) === text) continue;
    const outcome = fixConverted(path, text);
    refused.push(...outcome.refused);
    if (outcome.text !== text) await writeFile(join(root, path), outcome.text);
  }
  return refused;
}

// The files a build wrote under dist/app, by name relative to it.
export async function builtFiles(project: string): Promise<Map<string, string>> {
  const output = join(project, "dist", "app");
  const names = await readdir(output, { recursive: true }).catch(() => []);
  const files = new Map<string, string>();
  for (const name of names.filter((n) => n.endsWith(".xml")).sort()) {
    const xml = await readFile(join(output, name), "utf8");
    if (!isEmptyUpdate(xml)) files.set(name, xml);
  }
  return files;
}

export const unitsOf = (files: ReadonlyMap<string, string>): BuiltUnit[] =>
  [...files].map(([name, xml]) => builtUnitOf(name, xml));

export async function unitsIn(project: string): Promise<BuiltUnit[]> {
  return unitsOf(await builtFiles(project));
}

// The embedded SDK working on copies of the workspace's projects: the workspace is written
// only when a draft is applied.
export class SdkToolchain implements FluentToolchain {
  constructor(
    private readonly workspace: string,
    private readonly load: LoadFluentRuntime,
  ) {}

  async build(project: SourceProject): Promise<BuildOutcome> {
    const runtime = await this.load();
    const scratch = await mkdtemp(join(tmpdir(), "snagentic-build-"));
    const copy = join(scratch, "project");
    try {
      await fromWorkingTree(join(this.workspace, project.path))(copy);
      const outcome = await runtime.build(copy);
      if (!outcome.success) return { ok: false, message: buildErrors(outcome.errors) };
      const files = await builtFiles(copy);
      return { ok: true, units: unitsOf(files), files };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  async draftTransform(
    project: SourceProject,
    records: readonly TransformTarget[],
    access: SdkAccess,
    commit?: string,
  ): Promise<DraftOutcome> {
    const runtime = await this.load();
    const source = join(this.workspace, project.path);
    sweepStaleScratch();
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
      const refused = await fixConversion(copy, original);
      if (refused.length > 0) return { ok: false, message: refused.join("; "), refused };
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
