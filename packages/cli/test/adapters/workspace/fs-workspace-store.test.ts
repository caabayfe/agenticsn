import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestFor } from "@snagentic/core";
import { runGit } from "../../../src/adapters/git/run-git";
import { FsWorkspaceStore } from "../../../src/adapters/workspace/fs-workspace-store";

const temporary: string[] = [];

async function scratch(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "snagentic-ws-")));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const store = new FsWorkspaceStore();

describe("FsWorkspaceStore", () => {
  it("creates the manifest, .gitignore and a tuned git repository", async () => {
    const root = join(await scratch(), "acme");
    await store.create(root, manifestFor("snagentic test"));
    expect(await readFile(join(root, "snagentic.yaml"), "utf8")).toBe(
      "created_with: snagentic test\nlayout: 1\n",
    );
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".snagentic/");
    const manyFiles = await runGit(["config", "--get", "feature.manyFiles"], root);
    expect(manyFiles.stdout.trim()).toBe("true");
    const branch = await runGit(["symbolic-ref", "--short", "HEAD"], root);
    expect(branch.stdout.trim()).toBe("main");
  });

  it("reads back the manifest it wrote", async () => {
    const root = join(await scratch(), "acme");
    await store.create(root, manifestFor("snagentic test"));
    expect(await store.readManifest(root)).toEqual({ layout: 1, createdWith: "snagentic test" });
  });

  it("reads no manifest from an ordinary folder", async () => {
    expect(await store.readManifest(await scratch())).toBeNull();
  });

  it("detects a folder inside a git repository, even before it exists", async () => {
    const repository = await scratch();
    await runGit(["init", "-q"], repository);
    expect(await store.isInsideGitRepository(join(repository, "not", "yet"))).toBe(true);
    expect(await store.isInsideGitRepository(await scratch())).toBe(false);
  });

  it("treats a missing or empty folder as usable and a folder with files as not", async () => {
    const root = await scratch();
    expect(await store.isEmptyOrMissing(join(root, "new"))).toBe(true);
    expect(await store.isEmptyOrMissing(root)).toBe(true);
    await writeFile(join(root, "notes.txt"), "x");
    expect(await store.isEmptyOrMissing(root)).toBe(false);
  });

  it("lists a folder and each of its parents, nearest first", async () => {
    const root = await scratch();
    await mkdir(join(root, "a", "b"), { recursive: true });
    const ancestors = store.ancestorsOf(join(root, "a", "b"));
    expect(ancestors.slice(0, 3)).toEqual([join(root, "a", "b"), join(root, "a"), root]);
    expect(ancestors.at(-1)).toBe("/");
  });
});
