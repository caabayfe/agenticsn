import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { MANIFEST_FILE, type PackSource } from "@snagentic/core";
import { parse } from "yaml";
import { DirectoryPackSource } from "./directory-pack-source";
import { EmbeddedPackSource, type EmbeddedPacks } from "./embedded-pack-source";
import { PACK_ROOTS } from "./pack-roots";

// Defined by the release build (scripts/build.ts): the binary holds the packs in an entry point
// of their own, loaded only by accelerator commands. Run from source, they are read from disk.
declare const SNAGENTIC_EMBEDDED_PACKS: boolean | undefined;

export const EMBEDDED_PACKS_ENTRY = "accelerator-packs";

const isPacks = (value: unknown): value is EmbeddedPacks =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every(
    (files) =>
      typeof files === "object" &&
      files !== null &&
      Object.values(files).every((text) => typeof text === "string"),
  );

export async function loadEmbeddedPacks(
  load: (specifier: string) => Promise<unknown> = (specifier) => import(specifier),
): Promise<PackSource> {
  // A computed specifier, so the bundler keeps the packs out of the main program.
  const module = await load(["./", EMBEDDED_PACKS_ENTRY, ".js"].join(""));
  const packs =
    typeof module === "object" && module !== null && "packs" in module ? module.packs : undefined;
  if (!isPacks(packs)) throw new Error("the embedded accelerator packs are incomplete");
  return new EmbeddedPackSource(packs);
}

// This file is packages/cli/src/adapters/accelerators/: five levels below the repository root.
const fromSource = async (): Promise<PackSource> =>
  new DirectoryPackSource(PACK_ROOTS.map((r) => join(import.meta.dir, "../../../../..", r)));

const shipped = (): Promise<PackSource> =>
  typeof SNAGENTIC_EMBEDDED_PACKS === "undefined" ? fromSource() : loadEmbeddedPacks();

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null && key in value
    ? Object.fromEntries(Object.entries(value))[key]
    : undefined;

// A workspace manifest's pack paths (`accelerators.paths`), resolved from its directory.
function pathsIn(text: string, dir: string): string[] {
  const paths = field(field(parse(text), "accelerators"), "paths");
  return Array.isArray(paths)
    ? paths.filter((p): p is string => typeof p === "string").map((p) => resolve(dir, p))
    : [];
}

// The pack paths of the workspace holding `start`; none outside a workspace.
export async function workspacePackRoots(start: string): Promise<string[]> {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    const text = await readFile(join(dir, MANIFEST_FILE), "utf8").catch(() => null);
    if (text !== null) return pathsIn(text, dir);
    if (dirname(dir) === dir) return [];
  }
}

// Packs from several sources: a pack id in an earlier source hides the same id in a later one,
// so a workspace's pack path can carry a newer version of a pack snagentic ships.
export class LayeredPackSource implements PackSource {
  constructor(private readonly sources: readonly PackSource[]) {}

  async ids(): Promise<readonly string[]> {
    const ids = new Set<string>();
    for (const source of this.sources) for (const id of await source.ids()) ids.add(id);
    return [...ids].sort();
  }

  async files(id: string): Promise<ReadonlyMap<string, string>> {
    for (const source of this.sources) {
      const files = await source.files(id);
      if (files.size > 0) return files;
    }
    return new Map();
  }

  parse(text: string): unknown {
    return parse(text);
  }
}

// The packs snagentic ships, under the workspace's pack paths (ADR-0038, item 7).
export async function loadPackSource(start: string): Promise<PackSource> {
  const roots = await workspacePackRoots(start);
  const own = await shipped();
  return roots.length === 0 ? own : new LayeredPackSource([new DirectoryPackSource(roots), own]);
}

// A pack source loaded once, on first use.
export class LazyPackSource implements PackSource {
  private loaded: Promise<PackSource> | undefined;

  constructor(private readonly load: () => Promise<PackSource>) {}

  private source(): Promise<PackSource> {
    this.loaded ??= this.load();
    return this.loaded;
  }

  async ids(): Promise<readonly string[]> {
    return (await this.source()).ids();
  }

  parse(text: string): unknown {
    return parse(text);
  }

  async files(id: string): Promise<ReadonlyMap<string, string>> {
    return (await this.source()).files(id);
  }
}
