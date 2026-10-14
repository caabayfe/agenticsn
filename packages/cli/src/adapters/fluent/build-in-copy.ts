import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadFluentRuntime } from "./fluent-runtime-loader";
import type { FluentBuildOutcome } from "./sdk-runtime";

// Build output and installed dependencies are never part of a project's source.
const NOT_SOURCE = new Set(["node_modules", "dist", ".now"]);

// Builds a copy of a Fluent project with the embedded SDK, so the workspace is never written
// (validate and plan are read-only), and hands the copy and the outcome to `use`.
export async function buildInCopy<T>(
  load: LoadFluentRuntime,
  source: string,
  use: (copy: string, outcome: FluentBuildOutcome) => Promise<T>,
): Promise<T> {
  const runtime = await load();
  const copy = join(await mkdtemp(join(tmpdir(), "snagentic-fluent-")), "project");
  try {
    await cp(source, copy, {
      recursive: true,
      filter: (path) => !NOT_SOURCE.has(path.slice(source.length + 1).split(/[\\/]/)[0] ?? ""),
    });
    return await use(copy, await runtime.build(copy));
  } finally {
    await rm(join(copy, ".."), { recursive: true, force: true });
  }
}
