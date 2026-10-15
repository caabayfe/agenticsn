import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitOrThrow } from "../git/run-git";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";
import type { FluentBuildOutcome } from "./sdk-runtime";

// Build output and installed dependencies are never part of a project's source.
const NOT_SOURCE = new Set(["node_modules", "dist", ".now"]);

// Fills an empty folder with a project's source.
export type ProjectSource = (copy: string) => Promise<void>;

// The project as the working tree holds it.
export const fromWorkingTree =
  (source: string): ProjectSource =>
  (copy) =>
    cp(source, copy, {
      recursive: true,
      filter: (path) => !NOT_SOURCE.has(path.slice(source.length + 1).split(/[\\/]/)[0] ?? ""),
    });

// The project as the index holds it (the pre-commit hook): a partial commit is built as it
// will be committed, so keys for flows left out of it never enter it (P5).
export const fromIndex =
  (workspace: string, project: string): ProjectSource =>
  async (copy) => {
    const files = await runGitOrThrow(["ls-files", "-z", "--", project], workspace);
    const scratch = join(copy, "..", "index");
    await runGitOrThrow(
      ["checkout-index", `--prefix=${scratch}/`, "--", ...files.split("\0").filter(Boolean)],
      workspace,
    );
    await cp(join(scratch, project), copy, { recursive: true });
  };

// Builds a copy of a Fluent project with the embedded SDK, so the workspace is never written
// (validate and plan are read-only), and hands the copy and the outcome to `use`.
export async function buildInCopy<T>(
  load: LoadFluentRuntime,
  fill: ProjectSource,
  use: (copy: string, outcome: FluentBuildOutcome) => Promise<T>,
): Promise<T> {
  const runtime = await load();
  const copy = join(await mkdtemp(join(tmpdir(), "snagentic-fluent-")), "project");
  try {
    await fill(copy);
    return await use(copy, await runtime.build(copy));
  } finally {
    await rm(join(copy, ".."), { recursive: true, force: true });
  }
}
