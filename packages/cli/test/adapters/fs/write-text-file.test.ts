import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeTextFile } from "../../../src/adapters/fs/write-text-file";

describe("writeTextFile", () => {
  it("creates missing folders and writes UTF-8 text", async () => {
    const base = await mkdtemp(join(tmpdir(), "snagentic-write-"));
    try {
      const path = join(base, "exports", "nested", "set.xml");
      await writeTextFile(path, "<unload>é</unload>\n");
      expect(await readFile(path, "utf8")).toBe("<unload>é</unload>\n");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
