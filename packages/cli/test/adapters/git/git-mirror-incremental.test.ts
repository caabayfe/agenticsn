import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  InstanceName,
  renderRecord,
} from "@snagentic/core";
import { GitMirror } from "../../../src/adapters/git/git-mirror";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const PDI = InstanceName.parse("pdi");
const ROOT = "instances/pdi/metadata";
const ONE = "global/sys_script/one--00000000000000000000000000000001";
const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata" },
  scopes: {},
  typedFields: { sys_script: { script: "script_server" } },
});
const record = (n: number, name: string, script: string) =>
  renderRecord(
    artifactFromRow(
      { sys_id: n.toString(16).padStart(32, "0"), sys_class_name: "sys_script", name, script },
      catalog,
      DEFAULT_REDACTION,
    ),
    catalog,
  );

// A repository whose remote branch holds one full pull of two records, one with child rows.
async function pulled(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "snagentic-incremental-"));
  temporary.push(repo);
  await runGitOrThrow(["init", "-q", "-b", "main"], repo);
  const mirror = await GitMirror.open(repo, PDI, "fresh");
  await mirror.write(ROOT, record(1, "One", "one();"));
  await mirror.write(ROOT, record(2, "Two", "two();"));
  await mirror.writeDocument(ROOT, `${ONE}.children.sys_ui_element.yaml`, [{ sys_id: "c" }]);
  await mirror.finish("full");
  return repo;
}

const tree = async (repo: string) =>
  (await runGitOrThrow(["ls-tree", "-r", "--name-only", "servicenow-remote/pdi", "--", ROOT], repo))
    .split("\n")
    .filter(Boolean)
    .map((path) => path.slice(ROOT.length + 1));

describe("GitMirror in incremental mode", () => {
  it("knows the mirrored records it starts from", async () => {
    const mirror = await GitMirror.open(await pulled(), PDI, "incremental");
    await mirror.prepare();
    expect(mirror.baseOf(ROOT, "00000000000000000000000000000001")).toBe(ONE);
    expect(mirror.filesOf(ROOT, ONE)).toEqual([
      `${ONE}.children.sys_ui_element.yaml`,
      `${ONE}.script.js`,
      `${ONE}.yaml`,
    ]);
    await mirror.abort();
  });

  it("commits only the changes on top of the previous pull", async () => {
    const repo = await pulled();
    const before = (await runGitOrThrow(["rev-parse", "servicenow-remote/pdi"], repo)).trim();
    const mirror = await GitMirror.open(repo, PDI, "incremental");
    await mirror.prepare();
    await mirror.write(ROOT, record(3, "Three", "three();"));
    await mirror.remove(ROOT, "global/sys_script/two--00000000000000000000000000000002.yaml");
    await mirror.remove(ROOT, "global/sys_script/two--00000000000000000000000000000002.script.js");
    const commit = (await mirror.finish("incremental")).commit;
    expect((await runGitOrThrow(["rev-parse", `${commit}^`], repo)).trim()).toBe(before);
    expect(await tree(repo)).toEqual([
      `${ONE}.children.sys_ui_element.yaml`,
      `${ONE}.script.js`,
      `${ONE}.yaml`,
      "global/sys_script/three--00000000000000000000000000000003.script.js",
      "global/sys_script/three--00000000000000000000000000000003.yaml",
    ]);
  });

  it("moves files to a renamed record's new base", async () => {
    const repo = await pulled();
    const mirror = await GitMirror.open(repo, PDI, "incremental");
    await mirror.prepare();
    const renamed = "global/sys_script/uno--00000000000000000000000000000001";
    await mirror.move(
      ROOT,
      `${ONE}.children.sys_ui_element.yaml`,
      `${renamed}.children.sys_ui_element.yaml`,
    );
    expect(mirror.baseOf(ROOT, "00000000000000000000000000000001")).toBe(renamed);
    await mirror.finish("incremental");
    expect(await tree(repo)).toContain(`${renamed}.children.sys_ui_element.yaml`);
    expect(await tree(repo)).not.toContain(`${ONE}.children.sys_ui_element.yaml`);
  });

  it("leaves the branch untouched when nothing changed", async () => {
    const repo = await pulled();
    const before = (await runGitOrThrow(["rev-parse", "servicenow-remote/pdi"], repo)).trim();
    const mirror = await GitMirror.open(repo, PDI, "incremental");
    await mirror.prepare();
    // Writing a record again with the same content is not a change.
    await mirror.write(ROOT, record(1, "One", "one();"));
    expect(await mirror.finish("incremental")).toEqual({ commit: before, created: false });
    expect((await runGitOrThrow(["rev-parse", "servicenow-remote/pdi"], repo)).trim()).toBe(before);
  });

  it("counts mirrored child rows per record, including this pull's writes", async () => {
    const repo = await pulled();
    const mirror = await GitMirror.open(repo, PDI, "incremental");
    await mirror.prepare();
    const two = "global/sys_script/two--00000000000000000000000000000002";
    await mirror.writeDocument(ROOT, `${two}.children.sys_ui_element.yaml`, [
      { sys_id: "a", label: "- not a row\n- nor this" },
      { sys_id: "b" },
    ]);
    const counts = await mirror.countChildRows(ROOT, "sys_ui_element");
    expect([...counts].sort()).toEqual([
      [ONE, 1],
      [two, 2],
    ]);
    expect((await mirror.countChildRows(ROOT, "sys_ui_list_element")).size).toBe(0);
    await mirror.abort();
  });

  it("reads the mirrored tree only when asked to", async () => {
    const mirror = await GitMirror.open(await pulled(), PDI, "incremental");
    expect(() => mirror.baseOf(ROOT, "00000000000000000000000000000001")).toThrow(/prepare/);
    await mirror.prepare();
    await mirror.prepare();
    expect(mirror.baseOf(ROOT, "00000000000000000000000000000001")).toBe(ONE);
    expect(await mirror.finish("nothing")).toMatchObject({ created: false });
  });

  it("refuses to start before a full pull exists", async () => {
    const repo = await mkdtemp(join(tmpdir(), "snagentic-incremental-"));
    temporary.push(repo);
    await runGitOrThrow(["init", "-q", "-b", "main"], repo);
    await expect(GitMirror.open(repo, PDI, "incremental")).rejects.toThrow(
      /servicenow-remote\/pdi/,
    );
  });
});
