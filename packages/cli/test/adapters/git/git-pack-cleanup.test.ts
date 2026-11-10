import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTemporaryPacks } from "../../../src/adapters/git/git-pack-cleanup";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-packs-"));
  folders.push(dir);
  return dir;
}

describe("removeTemporaryPacks", () => {
  it("removes only the temporary packs written since the mirror session opened", async () => {
    const root = await repository();
    const packs = join(root, ".git", "objects", "pack");
    await mkdir(packs, { recursive: true });
    const openedAt = Date.now() - 60_000;
    const before = new Date(openedAt - 60_000);
    await writeFile(join(packs, "tmp_pack_new"), "");
    await writeFile(join(packs, "tmp_pack_old"), "");
    await utimes(join(packs, "tmp_pack_old"), before, before);
    await writeFile(join(packs, "pack-1.pack"), "");
    await removeTemporaryPacks(root, openedAt);
    expect((await readdir(packs)).sort()).toEqual(["pack-1.pack", "tmp_pack_old"]);
  });

  it("does nothing for a repository that has no pack folder yet", async () => {
    const root = await repository();
    await removeTemporaryPacks(root, 0);
    expect(await readdir(root)).toEqual([]);
  });
});
