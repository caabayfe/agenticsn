import { sep } from "node:path";

// snagentic names workspace files with / on every platform: record bases, documentation pages,
// census scopes. The file system and Bun.Glob give \ on Windows.
export const posixPath = (path: string, separator: string = sep): string =>
  separator === "/" ? path : path.split(separator).join("/");

// Bun.Glob's scan, with each path relative to `cwd` and / separators.
export async function* scanPosix(pattern: string, cwd: string): AsyncGenerator<string> {
  for await (const path of new Bun.Glob(pattern).scan({ cwd })) {
    yield posixPath(path);
  }
}
