import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshIndex } from "@snagentic/core";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { GitMirrorFiles } from "../../../src/adapters/knowledge/git-mirror-files";
import { SqliteKnowledgeStore } from "../../../src/adapters/knowledge/sqlite-knowledge-store";
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

  it("reads a record's fields and the text of all its files", async () => {
    const { files, write } = await workspace();
    await write(
      `${RULE}.yaml`,
      toYaml({ _meta: { sys_id: "b1" }, name: "Set priority", collection: "incident" }),
    );
    await write(`${RULE}.script.js`, "new Prioritizer();\n");
    const document = await files.readDocument(RULE);
    expect(document.record).toEqual({
      meta: { sys_id: "b1" },
      fields: { name: "Set priority", collection: "incident" },
    });
    expect(document.text).toContain("new Prioritizer();");
    expect(document.text).toContain("name: Set priority");
    expect(await files.readDocument("global/sys_script/gone--b9")).toEqual({
      record: null,
      text: "",
    });
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
    // Only the files of the records named.
    expect(
      await files.grep(["Prioritizer"], { limit: 10, bases: ["global/sys_script/other--b2"] }),
    ).toEqual([]);
    expect(
      (await files.grep(["Prioritizer"], { limit: 10, bases: [RULE] })).map((h) => h.line),
    ).toEqual([1, 2]);
  });

  it("reports staged, deleted and untracked files, renames as both paths, nothing outside the mirror", async () => {
    const { repo, files, write } = await workspace();
    await write(`${RULE}.yaml`, "name: x\n");
    await write("global/sys_script/old name--b3.yaml", "name: z\n");
    await write("global/sys_script/gone--b4.yaml", "name: g\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "pull");
    const head = await files.head();
    await write("global/sys_script/staged--b2.yaml", "name: y\n");
    await git(repo, "add", ".");
    await git(
      repo,
      "mv",
      `${ROOT}/global/sys_script/old name--b3.yaml`,
      `${ROOT}/global/sys_script/new--b3.yaml`,
    );
    await rm(join(repo, ROOT, "global/sys_script/gone--b4.yaml"));
    await write("global/sys_script/untracked--b5.yaml", "name: u\n");
    await write("global/sys_new_class/first--b6.yaml", "name: n\n");
    await write("global/sys_new_class/deeper/second--b7.yaml", "name: n\n");
    await writeFile(join(repo, "outside.txt"), "not the mirror\n");
    await mkdir(join(repo, "instances/other/metadata"), { recursive: true });
    await writeFile(join(repo, "instances/other/metadata/x--1.yaml"), "name: o\n");
    expect(await files.changes(head)).toEqual({
      committed: [],
      dirty: [
        "global/sys_new_class/deeper/second--b7.yaml",
        "global/sys_new_class/first--b6.yaml",
        "global/sys_script/gone--b4.yaml",
        "global/sys_script/new--b3.yaml",
        "global/sys_script/old name--b3.yaml",
        "global/sys_script/staged--b2.yaml",
        "global/sys_script/untracked--b5.yaml",
      ],
    });
  });
});

describe("refreshing the knowledge index from the workspace", () => {
  const yaml = (sysId: string, name: string) =>
    toYaml({ _meta: { sys_id: sysId, sys_class_name: "sys_script" }, name });

  async function indexed() {
    const ws = await workspace();
    // Outside the repository: `git add .` must not stage it (workspaces ignore .snagentic).
    const state = await mkdtemp(join(tmpdir(), "snagentic-index-"));
    temporary.push(state);
    const store = new SqliteKnowledgeStore(join(state, "knowledge.sqlite"));
    const names = async () => {
      await refreshIndex(store, new GitMirrorFiles(ws.repo, ROOT));
      return (await store.search({ limit: 50 })).records.map((r) => r.name).sort();
    };
    await ws.write(`${RULE}.yaml`, yaml("b1", "Set priority"));
    await ws.write("global/sys_script/other--b2.yaml", yaml("b2", "Other"));
    await git(ws.repo, "add", ".");
    await git(ws.repo, "commit", "-qm", "pull");
    return { ...ws, store, names };
  }

  it("re-reads nothing when nothing changed, and an edited file once it is edited", async () => {
    const { repo, store, write, names } = await indexed();
    try {
      expect(await names()).toEqual(["Other", "Set priority"]);
      const again = await refreshIndex(store, new GitMirrorFiles(repo, ROOT));
      expect(again).toMatchObject({ indexed: 0, removed: 0, records: 2 });
      await write(`${RULE}.yaml`, yaml("b1", "Set priority now"));
      expect(await names()).toEqual(["Other", "Set priority now"]);
    } finally {
      store.close();
    }
  });

  it("lists the files of a mirror that is not committed at all", async () => {
    const { repo, files, write } = await workspace();
    await writeFile(join(repo, "README.md"), "x\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "init");
    await write(`${RULE}.yaml`, "name: x\n");
    await write(`${RULE}.script.js`, "x\n");
    expect((await files.changes(await files.head())).dirty).toEqual([
      `${RULE}.script.js`,
      `${RULE}.yaml`,
    ]);
  });

  it("sees an untracked file, a staged one, a deletion, and an edit that was undone", async () => {
    const { repo, store, write, names } = await indexed();
    try {
      await names();
      await write("global/sys_script/new--b3.yaml", yaml("b3", "Untracked"));
      expect(await names()).toEqual(["Other", "Set priority", "Untracked"]);
      await git(repo, "add", ".");
      expect(await names()).toEqual(["Other", "Set priority", "Untracked"]);
      await write("global/sys_script/new--b3.yaml", yaml("b3", "Staged then edited"));
      expect(await names()).toEqual(["Other", "Set priority", "Staged then edited"]);
      await rm(join(repo, ROOT, "global/sys_script/other--b2.yaml"));
      expect(await names()).toEqual(["Set priority", "Staged then edited"]);
      // Undoing every edit brings the index back to the commit.
      await git(repo, "reset", "-q", "--hard");
      await rm(join(repo, ROOT, "global/sys_script/new--b3.yaml"), { force: true });
      expect(await names()).toEqual(["Other", "Set priority"]);
    } finally {
      store.close();
    }
  });
});
