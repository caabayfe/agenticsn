import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { GitMirrorFiles } from "../../../src/adapters/knowledge/git-mirror-files";
import { toYaml } from "../../../src/adapters/yaml/own-style";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const ROOT = "instances/pdi/metadata";
const RULE = "global/sys_script/set-priority--b1";
const git = (repo: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], repo);

async function workspace() {
  const repo = await mkdtemp(join(tmpdir(), "snagentic-files-"));
  temporary.push(repo);
  await runGitOrThrow(["init", "-q", "-b", "main"], repo);
  const files = new GitMirrorFiles(repo, ROOT);
  const write = async (path: string, content: string) => {
    await mkdir(join(repo, ROOT, path, ".."), { recursive: true });
    await writeFile(join(repo, ROOT, path), content);
  };
  return { repo, files, write };
}

describe("GitMirrorFiles", () => {
  it("has no head before the first commit", async () => {
    expect(await (await workspace()).files.head()).toBeNull();
  });

  it("lists every file the first time, then what was committed since and what is edited now", async () => {
    const { repo, files, write } = await workspace();
    await write(
      `${RULE}.yaml`,
      toYaml({ _meta: { sys_id: "b1", sys_class_name: "sys_script" }, name: "Set priority" }),
    );
    await write(`${RULE}.script.js`, "current.priority = 1;\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "pull");
    const first = await files.head();
    expect((await files.changes(null)).committed.sort()).toEqual([
      `${RULE}.script.js`,
      `${RULE}.yaml`,
    ]);
    await write("global/sys_script/new--b2.yaml", "name: New\n");
    await write(`${RULE}.script.js`, "current.priority = 2;\n");
    expect(await files.changes(first)).toEqual({
      committed: [],
      dirty: ["global/sys_script/new--b2.yaml", `${RULE}.script.js`],
    });
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "edit");
    expect((await files.changes(first)).committed.sort()).toEqual([
      "global/sys_script/new--b2.yaml",
      `${RULE}.script.js`,
    ]);
  });

  it("reads a record's fields, and nothing for a file that is gone", async () => {
    const { files, write } = await workspace();
    await write(
      `${RULE}.yaml`,
      toYaml({ _meta: { sys_id: "b1" }, name: "Set priority", collection: "incident" }),
    );
    expect(await files.readRecord(`${RULE}.yaml`)).toEqual({
      meta: { sys_id: "b1" },
      fields: { name: "Set priority", collection: "incident" },
    });
    expect(await files.readRecord("global/sys_script/gone--b9.yaml")).toBeNull();
  });

  it("lists the files beside a record", async () => {
    const { files, write } = await workspace();
    await write(`${RULE}.yaml`, "name: x\n");
    await write(`${RULE}.script.js`, "x\n");
    await write("global/sys_script/set-priority-2--b2.yaml", "name: y\n");
    expect(await files.filesOf(RULE)).toEqual([`${RULE}.script.js`, `${RULE}.yaml`]);
    expect(await files.filesOf("global/missing/x--1")).toEqual([]);
  });

  it("searches the files' text, including local edits, up to a limit", async () => {
    const { repo, files, write } = await workspace();
    await write(`${RULE}.script.js`, "var a = new Prioritizer();\nvar b = new Prioritizer();\n");
    await write("global/sys_script/other--b2.script.js", "new Prioritizer();\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "pull");
    await write("global/sys_script/other--b2.script.js", "// no longer used\n");
    const hits = await files.grep(["new Prioritizer"], { limit: 10 });
    expect(hits.map((hit) => [hit.path, hit.line])).toEqual([
      [`${RULE}.script.js`, 1],
      [`${RULE}.script.js`, 2],
    ]);
    expect(await files.grep(["new Prioritizer"], { limit: 1 })).toHaveLength(1);
    expect(await files.grep(["nothing like this"], { limit: 5 })).toEqual([]);
    // Several texts in one pass; whole words only when asked.
    expect(
      (await files.grep(["Prioritizer", "used"], { limit: 10, wholeWords: true })).map(
        (h) => h.line,
      ),
    ).toEqual([1, 1, 2]);
    expect(await files.grep(["Prioritiz"], { limit: 10, wholeWords: true })).toEqual([]);
  });
});
