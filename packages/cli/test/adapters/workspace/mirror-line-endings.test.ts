import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestFor } from "@snagentic/core";
import { runGit, runGitOrThrow } from "../../../src/adapters/git/run-git";
import { FsWorkspaceStore } from "../../../src/adapters/workspace/fs-workspace-store";

// Spec 014, 1b-L: with core.autocrlf=true (the Windows default) git checks text out with CRLF;
// the workspace's .gitattributes keeps the mirror byte for byte on every platform.
const temporary: string[] = [];
const IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t"];
const SCRIPT = "instances/dev/metadata/sys_script_include/x.js";

async function scratch(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "snagentic-eol-")));
  temporary.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

// A workspace whose mirror holds one LF script, and a notes file outside the mirror.
async function workspace(): Promise<string> {
  const root = join(await scratch(), "acme");
  await new FsWorkspaceStore().create(root, manifestFor("snagentic test"));
  await mkdir(join(root, "instances/dev/metadata/sys_script_include"), { recursive: true });
  await writeFile(join(root, SCRIPT), "var a = 1;\nvar b = 2;\n");
  await writeFile(join(root, "notes.txt"), "one\ntwo\n");
  await runGitOrThrow(["add", "-A"], root);
  await runGitOrThrow([...IDENTITY, "commit", "-q", "-m", "mirror"], root);
  return root;
}

async function cloneWithAutocrlf(root: string): Promise<string> {
  const clone = join(await scratch(), "clone");
  await runGitOrThrow(["clone", "-q", "-c", "core.autocrlf=true", root, clone], root);
  return clone;
}

describe("mirror line endings", () => {
  it("init writes the mirror rule into .gitattributes and commits it", async () => {
    const root = join(await scratch(), "acme");
    await new FsWorkspaceStore().create(root, manifestFor("snagentic test"));
    expect(await readFile(join(root, ".gitattributes"), "utf8")).toContain("instances/** -text\n");
    const committed = await runGit(["ls-files", ".gitattributes"], root);
    expect(committed.stdout.trim()).toBe(".gitattributes");
    expect((await runGit(["status", "--porcelain"], root)).stdout).toBe("");
  });

  it("init merges the rule into a .gitattributes already there, keeping its lines", async () => {
    const root = join(await scratch(), "acme");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, ".gitattributes"), "*.png binary\n");
    await new FsWorkspaceStore().create(root, manifestFor("snagentic test"));
    const text = await readFile(join(root, ".gitattributes"), "utf8");
    expect(text.startsWith("*.png binary\n")).toBe(true);
    expect(text.split("instances/** -text").length).toBe(2);
  });

  it("a clone with core.autocrlf=true checks the mirror out with LF", async () => {
    const clone = await cloneWithAutocrlf(await workspace());
    expect(await readFile(join(clone, SCRIPT), "utf8")).toBe("var a = 1;\nvar b = 2;\n");
    // autocrlf is in effect: files outside the mirror are still converted.
    expect(await readFile(join(clone, "notes.txt"), "utf8")).toBe("one\r\ntwo\r\n");
  });

  it("a clone checked out with CRLF before the rule gets LF from the documented command", async () => {
    const root = await workspace();
    await writeFile(join(root, ".gitattributes"), "");
    await runGitOrThrow([...IDENTITY, "commit", "-q", "-am", "no rule"], root);
    const clone = await cloneWithAutocrlf(root);
    expect(await readFile(join(clone, SCRIPT), "utf8")).toBe("var a = 1;\r\nvar b = 2;\r\n");
    // The rule lands (a teammate's commit, or the doctor hint); only .gitattributes is committed.
    await writeFile(join(clone, ".gitattributes"), "instances/** -text\n");
    await runGitOrThrow(["add", ".gitattributes"], clone);
    await runGitOrThrow([...IDENTITY, "commit", "-q", "-m", "mirror rule"], clone);
    await runGitOrThrow(["rm", "-r", "--cached", "-q", "instances"], clone);
    await runGitOrThrow(["checkout", "HEAD", "--", "instances"], clone);
    expect(await readFile(join(clone, SCRIPT), "utf8")).toBe("var a = 1;\nvar b = 2;\n");
    expect((await runGit(["status", "--porcelain"], clone)).stdout).toBe("");
  });
});
