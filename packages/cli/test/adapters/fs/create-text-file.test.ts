import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTextFile } from "../../../src/adapters/fs/create-text-file";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createTextFile", () => {
  it("creates a new file and its folders, and never replaces a file or follows a link", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-"));
    dirs.push(dir);
    expect(await createTextFile(join(dir, "a/b.xml"), "new")).toBe("created");
    expect(await readFile(join(dir, "a/b.xml"), "utf8")).toBe("new");
    expect(await createTextFile(join(dir, "a/b.xml"), "again")).toBe("exists");
    expect(await readFile(join(dir, "a/b.xml"), "utf8")).toBe("new");
    await writeFile(join(dir, "target"), "theirs");
    await symlink(join(dir, "target"), join(dir, "link"));
    await symlink(join(dir, "missing"), join(dir, "dangling"));
    expect(await createTextFile(join(dir, "link"), "x")).toBe("exists");
    expect(await createTextFile(join(dir, "dangling"), "x")).toBe("exists");
    expect(await readFile(join(dir, "target"), "utf8")).toBe("theirs");
  });

  it("reports other failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "create-"));
    dirs.push(dir);
    await mkdir(join(dir, "locked"));
    await chmod(join(dir, "locked"), 0o500);
    await expect(createTextFile(join(dir, "locked/x.xml"), "x")).rejects.toMatchObject({
      code: "EACCES",
    });
    await chmod(join(dir, "locked"), 0o700);
  });
});
