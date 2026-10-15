import { join } from "node:path";
import type { PackSource } from "@snagentic/core";
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

export const loadPackSource = (): Promise<PackSource> =>
  typeof SNAGENTIC_EMBEDDED_PACKS === "undefined" ? fromSource() : loadEmbeddedPacks();

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

  async manifest(id: string): Promise<unknown | null> {
    return (await this.source()).manifest(id);
  }

  async files(id: string): Promise<ReadonlyMap<string, string>> {
    return (await this.source()).files(id);
  }
}
