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
      "created_with: snagentic test\nlayout: 2\n",
    );
    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(".snagentic/");
    const manyFiles = await runGit(["config", "--get", "feature.manyFiles"], root);
    expect(manyFiles.stdout.trim()).toBe("true");
    const branch = await runGit(["symbolic-ref", "--short", "HEAD"], root);
    expect(branch.stdout.trim()).toBe("main");
  });

  it("records the workspace files in a first commit, so git status starts clean", async () => {
    const root = join(await scratch(), "acme");
    await store.create(root, manifestFor("snagentic test"));
    expect((await runGit(["log", "--format=%s", "-1"], root)).stdout.trim()).toBe("snagentic init");
    expect((await runGit(["status", "--porcelain"], root)).stdout).toBe("");
  });

  it("reads back the manifest it wrote", async () => {
    const root = join(await scratch(), "acme");
    await store.create(root, manifestFor("snagentic test"));
    expect(await store.readManifest(root)).toEqual({ layout: 2, createdWith: "snagentic test" });
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

  // Spec 014, PERF2-04: a teammate's `git clone` of the workspace gets none of init's tuning.
  it("reports a plain clone's missing tuning, then sets it in the clone's own config", async () => {
    const root = join(await scratch(), "acme");
    await store.create(root, manifestFor("snagentic test"));
    const clone = join(await scratch(), "clone");
    await runGit(["clone", "-q", root, clone], root);
    await runGit(["config", "--local", "core.untrackedCache", "false"], clone);
    const before = await store.repositoryTuning(clone);
    expect(before?.find((s) => s.key === "feature.manyFiles")?.current ?? null).toBeNull();
    expect(before?.find((s) => s.key === "core.untrackedCache")?.current).toBe("false");
    await store.tuneRepository(clone, [{ key: "feature.manyFiles", value: "true" }]);
    const local = await runGit(["config", "--local", "--get", "feature.manyFiles"], clone);
    expect(local.stdout.trim()).toBe("true");
    const after = await store.repositoryTuning(clone);
    expect(after?.find((s) => s.key === "feature.manyFiles")?.current).toBe("true");
  });

  it("init's own repository has every setting it reports", async () => {
    const root = join(await scratch(), "acme");
    await store.create(root, manifestFor("snagentic test"));
    const settings = (await store.repositoryTuning(root)) ?? [];
    expect(settings.length).toBeGreaterThan(1);
    expect(settings.every((setting) => setting.current !== null)).toBe(true);
  });

  it("reports no tuning for a folder outside any git repository", async () => {
    expect(await store.repositoryTuning(await scratch())).toBeNull();
  });
});
