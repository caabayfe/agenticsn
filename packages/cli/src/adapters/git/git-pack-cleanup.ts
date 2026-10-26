import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// Removes only temporary packs created after this mirror session opened.
export async function removeTemporaryPacks(repository: string, openedAt: number): Promise<void> {
  const directory = join(repository, ".git", "objects", "pack");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    names = [];
  }
  for (const name of names) {
    const path = join(directory, name);
    if (name.startsWith("tmp_") && (await stat(path)).mtimeMs >= openedAt) {
      await rm(path, { force: true });
    }
  }
}
