import { expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTemporaryPacks } from "../../../src/adapters/git/git-pack-cleanup";

it("ignores a missing pack directory and removes only this session's temporary packs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pack-cleanup-"));
  try {
    await removeTemporaryPacks(root, 0);
    const packs = join(root, ".git/objects/pack");
    await mkdir(packs, { recursive: true });
    await writeFile(join(packs, "tmp_earlier"), "old");
    await writeFile(join(packs, "tmp_current"), "new");
    await writeFile(join(packs, "pack-persistent.pack"), "keep");
    const openedAt = (await stat(join(packs, "tmp_earlier"))).mtimeMs + 1;
    await removeTemporaryPacks(root, openedAt);
    expect(await stat(join(packs, "tmp_earlier"))).toBeDefined();
    expect(await stat(join(packs, "pack-persistent.pack"))).toBeDefined();
    await removeTemporaryPacks(root, 0);
    expect(await stat(join(packs, "tmp_current")).catch(() => null)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
