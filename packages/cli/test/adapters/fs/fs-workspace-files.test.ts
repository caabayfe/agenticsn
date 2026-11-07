import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsWorkspaceFiles } from "../../../src/adapters/fs/fs-workspace-files";

describe("fsWorkspaceFiles", () => {
  it("removes a file, and does nothing for one that is not there", async () => {
    const base = await mkdtemp(join(tmpdir(), "snagentic-files-"));
    try {
      const path = join(base, "ensure-list-x.now.ts");
      await writeFile(path, "Record({})");
      await fsWorkspaceFiles.remove(path);
      expect(await fsWorkspaceFiles.read(path)).toBeNull();
      await fsWorkspaceFiles.remove(path);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("lists a directory's files by name, sorted, and none for a directory that is not there", async () => {
    const base = await mkdtemp(join(tmpdir(), "snagentic-files-"));
    try {
      await writeFile(join(base, "b.now.ts"), "");
      await writeFile(join(base, "a.now.ts"), "");
      await mkdir(join(base, "generated"));
      expect(await fsWorkspaceFiles.list(base)).toEqual(["a.now.ts", "b.now.ts"]);
      expect(await fsWorkspaceFiles.list(join(base, "missing"))).toEqual([]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
