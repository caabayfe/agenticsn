import type { PackSource } from "@snagentic/core";
import { parse } from "yaml";
import { DirectoryPackSource } from "./directory-pack-source";

const MANIFEST = "accelerator.yaml";

// Each pack's files by path in the pack, by pack id: what the release build embeds.
export type EmbeddedPacks = Readonly<Record<string, Readonly<Record<string, string>>>>;

// Every pack under the roots, read for the build to embed.
export async function collectPacks(roots: readonly string[]): Promise<EmbeddedPacks> {
  const source = new DirectoryPackSource(roots);
  const packs: Record<string, Record<string, string>> = {};
  for (const id of await source.ids()) packs[id] = Object.fromEntries(await source.files(id));
  return packs;
}

// The packs the binary embeds (spec 005, 4.2).
export class EmbeddedPackSource implements PackSource {
  constructor(private readonly packs: EmbeddedPacks) {}

  async ids(): Promise<readonly string[]> {
    return Object.keys(this.packs).sort();
  }

  async manifest(id: string): Promise<unknown | null> {
    const text = this.packs[id]?.[MANIFEST];
    return text === undefined ? null : parse(text);
  }

  async files(id: string): Promise<ReadonlyMap<string, string>> {
    return new Map(Object.entries(this.packs[id] ?? {}));
  }
}
