import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PackSource } from "@snagentic/core";
import { parse } from "yaml";

const MANIFEST = "accelerator.yaml";

// Packs as directories holding an accelerator.yaml, under each root (ADR-0026). A root that
// does not exist holds no packs.
export class DirectoryPackSource implements PackSource {
  constructor(private readonly roots: readonly string[]) {}

  private async where(id: string): Promise<string | null> {
    for (const root of this.roots) {
      const path = join(root, id, MANIFEST);
      if ((await readFile(path, "utf8").catch(() => null)) !== null) return path;
    }
    return null;
  }

  async ids(): Promise<readonly string[]> {
    const ids = new Set<string>();
    for (const root of this.roots) {
      for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory() && (await this.where(entry.name)) !== null) ids.add(entry.name);
      }
    }
    return [...ids].sort();
  }

  async manifest(id: string): Promise<unknown | null> {
    const path = await this.where(id);
    return path === null ? null : parse(await readFile(path, "utf8"));
  }
}
