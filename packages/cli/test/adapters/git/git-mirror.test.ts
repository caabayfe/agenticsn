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
import { runGit, runGitOrThrow } from "../../../src/adapters/git/run-git";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "snagentic-mirror-"));
  temporary.push(directory);
  await runGitOrThrow(["init", "-q", "-b", "main"], directory);
  return directory;
}

const PDI = InstanceName.parse("pdi");
const ROOT = "instances/pdi/metadata";
const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata" },
  scopes: {},
  typedFields: { sys_script: { script: "script_server" } },
});
const record = (n: number, name: string) =>
  renderRecord(
    artifactFromRow(
      {
        sys_id: n.toString(16).padStart(32, "0"),
        sys_class_name: "sys_script",
        name,
        script: `run${n}();`,
      },
      catalog,
      DEFAULT_REDACTION,
    ),
    catalog,
  );

async function files(repo: string, ref: string): Promise<string[]> {
  return (await runGitOrThrow(["ls-tree", "-r", "--name-only", ref], repo))
    .split("\n")
    .filter(Boolean);
}

describe("GitMirror", () => {
  it("commits a pull as one commit on servicenow-remote/<name> with every file", async () => {
    const repo = await repository();
    const mirror = await GitMirror.open(repo, PDI, false);
    await mirror.write(ROOT, record(1, "One"));
    await mirror.checkpoint();
    await mirror.write(ROOT, record(2, "Two"));
    await mirror.writeDocument("instances/pdi/operational", "v_plugin.yaml", [{ id: "com.a" }]);
    const commit = await mirror.finish("snagentic pull pdi: full");
    expect(await files(repo, "servicenow-remote/pdi")).toEqual([
      "instances/pdi/metadata/global/sys_script/one--00000000000000000000000000000001.script.js",
      "instances/pdi/metadata/global/sys_script/one--00000000000000000000000000000001.yaml",
      "instances/pdi/metadata/global/sys_script/two--00000000000000000000000000000002.script.js",
      "instances/pdi/metadata/global/sys_script/two--00000000000000000000000000000002.yaml",
      "instances/pdi/operational/v_plugin.yaml",
    ]);
    expect((await runGitOrThrow(["rev-list", "--count", commit], repo)).trim()).toBe("1");
    expect((await runGitOrThrow(["log", "-1", "--format=%an %s", commit], repo)).trim()).toBe(
      "snagentic snagentic pull pdi: full",
    );
    expect(
      (await runGit(["rev-parse", "--verify", "--quiet", "refs/snagentic/pull/pdi"], repo))
        .exitCode,
    ).not.toBe(0);
  });

  it("replaces the tree on the next full pull and keeps the previous pull as parent", async () => {
    const repo = await repository();
    const first = await GitMirror.open(repo, PDI, false);
    await first.write(ROOT, record(1, "One"));
    const before = await first.finish("pull 1");
    const second = await GitMirror.open(repo, PDI, false);
    await second.write(ROOT, record(2, "Two"));
    const after = await second.finish("pull 2");
    expect((await files(repo, after)).some((path) => path.includes("one--"))).toBe(false);
    expect((await runGitOrThrow(["rev-parse", `${after}^`], repo)).trim()).toBe(before);
  });

  it("resumes an interrupted pull from what git durably holds", async () => {
    const repo = await repository();
    const interrupted = await GitMirror.open(repo, PDI, false);
    await interrupted.write(ROOT, record(1, "One"));
    await interrupted.checkpoint();
    await interrupted.write(ROOT, record(9, "Lost")); // never checkpointed
    await interrupted.abort();
    const resumed = await GitMirror.open(repo, PDI, true);
    const known = [];
    for await (const base of resumed.bases(ROOT)) {
      known.push(base);
    }
    expect(known).toEqual(["global/sys_script/one--00000000000000000000000000000001"]);
    await resumed.write(ROOT, record(2, "Two"));
    const commit = await resumed.finish("resumed");
    const names = (await files(repo, commit)).map((path) => path.split("/").at(-1));
    expect(names).toEqual([
      "one--00000000000000000000000000000001.script.js",
      "one--00000000000000000000000000000001.yaml",
      "two--00000000000000000000000000000002.script.js",
      "two--00000000000000000000000000000002.yaml",
    ]);
  });

  it("commits an empty tree when a pull wrote nothing", async () => {
    const repo = await repository();
    const commit = await (await GitMirror.open(repo, PDI, false)).finish("empty");
    expect(await files(repo, commit)).toEqual([]);
  });

  it("stores paths with spaces, as legacy sys_ids have", async () => {
    const repo = await repository();
    const mirror = await GitMirror.open(repo, PDI, false);
    await mirror.writeDocument(ROOT, "global/sys_ui_view/default-view--Default view.yaml", {
      _meta: { sys_id: "Default view" },
    });
    const commit = await mirror.finish("legacy id");
    expect(await files(repo, commit)).toEqual([
      "instances/pdi/metadata/global/sys_ui_view/default-view--Default view.yaml",
    ]);
  });
});

describe("FastImport failures", () => {
  it("fails instead of hanging when git stops on a malformed stream", async () => {
    const { FastImport } = await import("../../../src/adapters/git/fast-import");
    const stream = FastImport.start(await repository());
    await stream.command("this is not a fast-import command\n");
    await expect(stream.sync()).rejects.toThrow(/fast-import stopped/);
  });
});
