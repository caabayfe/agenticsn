import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { posixPath, scanPosix } from "../../../src/adapters/fs/posix-paths";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workspace paths with / on every platform", () => {
  it("turns a Windows relative path into one with / separators", () => {
    expect(posixPath("processes\\incident\\use\\a.md", "\\")).toBe("processes/incident/use/a.md");
    expect(posixPath("processes/incident/use/a.md", "/")).toBe("processes/incident/use/a.md");
  });

  it("scans a folder and names what it finds with / separators", async () => {
    const root = await mkdtemp(join(tmpdir(), "scan-"));
    dirs.push(root);
    await mkdir(join(root, "a", "b"), { recursive: true });
    await writeFile(join(root, "a", "b", "c.md"), "");
    expect(await Array.fromAsync(scanPosix("**/*.md", root))).toEqual(["a/b/c.md"]);
  });
});
