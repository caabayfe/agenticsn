import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
