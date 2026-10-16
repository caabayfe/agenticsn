import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  InstanceName,
  renderRecord,
} from "@snagentic/core";
import { gitIntegrator } from "../../../src/adapters/git/git-integrator";
import { GitMirror } from "../../../src/adapters/git/git-mirror";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { FsWorkspaceStore } from "../../../src/adapters/workspace/fs-workspace-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const PDI = InstanceName.parse("pdi");
const catalog = new Catalog({
  parents: {
    sys_metadata: null,
    sys_script: "sys_metadata",
    sys_script_include: "sys_metadata",
    sys_properties: "sys_metadata",
  },
  scopes: {},
  typedFields: {
    sys_script: { script: "script_server" },
    sys_script_include: { script: "script_server" },
  },
});
const SCRIPT_PATH =
  "instances/pdi/metadata/global/sys_script/rule--00000000000000000000000000000001.script.js";

async function workspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "snagentic-integrate-"));
  temporary.push(base);
  const root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 1, createdWith: "test" });
  return root;
}

const ruleRow = (script: string) => ({
  sys_id: "00000000000000000000000000000001",
  sys_class_name: "sys_script",
  name: "Rule",
  script,
});

// A pull that finds exactly these rows on the instance.
async function pullRows(root: string, rows: readonly Record<string, string>[]): Promise<void> {
  const mirror = await GitMirror.open(root, PDI, "fresh");
  for (const row of rows) {
    await mirror.write(
      "instances/pdi/metadata",
      renderRecord(artifactFromRow(row, catalog, DEFAULT_REDACTION), catalog),
    );
  }
  await mirror.finish("pull");
}

const pullScript = (root: string, script: string) => pullRows(root, [ruleRow(script)]);

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);
const integrator = gitIntegrator;

const NEW_ID = "4944d956393ce479c7b489974061fefd";
const NEW_BASE = `instances/pdi/metadata/global/sys_script_include/util--${NEW_ID}`;

describe("GitIntegrator", () => {
  it("merges the first pull into a new workspace and checks the files out", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    const result = await integrator.integrate(root, "pdi");
    expect(result.changedFiles).toBe(2);
    expect(await readFile(join(root, SCRIPT_PATH), "utf8")).toBe("one();\n");
    expect((await git(root, "log", "-1", "--format=%s")).trim()).toBe("snagentic integrate pdi");
  });

  it("starts the history from the pull in a repository without any commit", async () => {
    const root = await workspace();
    await rm(join(root, ".git"), { recursive: true, force: true });
    await runGitOrThrow(["init", "-q", "-b", "main"], root);
    await pullScript(root, "one();");
    const result = await integrator.integrate(root, "pdi");
    expect(result.changedFiles).toBe(2);
    expect(await readFile(join(root, SCRIPT_PATH), "utf8")).toBe("one();\n");
  });

  it("merges a new pull into a branch that has its own commits", async () => {
    const root = await workspace();
    await writeFile(join(root, "README.md"), "team notes\n");
    await git(root, "add", "README.md");
    await git(root, "commit", "-q", "-m", "team notes");
    await pullScript(root, "one();");
    const result = await integrator.integrate(root, "pdi");
    expect(result.commit).not.toBeNull();
    expect((await git(root, "log", "-1", "--format=%s")).trim()).toBe("snagentic integrate pdi");
  });

  it("ignores untracked files outside the synced folders, such as the instance profile", async () => {
    const root = await workspace();
    await mkdir(join(root, "instances/pdi"), { recursive: true });
    await writeFile(join(root, "instances/pdi/instance.yaml"), "kind: development\n");
    await pullScript(root, "one();");
    expect((await integrator.integrate(root, "pdi")).changedFiles).toBe(2);
  });

  it("still merges on a machine with no git identity configured", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    const saved = {
      global: process.env["GIT_CONFIG_GLOBAL"],
      nosystem: process.env["GIT_CONFIG_NOSYSTEM"],
    };
    process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    try {
      const result = await integrator.integrate(root, "pdi");
      expect(result.commit).not.toBeNull();
      expect((await runGitOrThrow(["log", "-1", "--format=%an"], root)).trim()).toBe("snagentic");
    } finally {
      for (const [key, value] of [
        ["GIT_CONFIG_GLOBAL", saved.global],
        ["GIT_CONFIG_NOSYSTEM", saved.nosystem],
      ] as const) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("reports when the workspace is already up to date", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    expect(await integrator.integrate(root, "pdi")).toEqual({
      commit: null,
      changedFiles: 0,
      discarded: [],
      pulled: [],
    });
  });

  it("explains that nothing was pulled yet", async () => {
    await expect(integrator.integrate(await workspace(), "pdi")).rejects.toMatchObject({
      code: "nothing-pulled",
    });
  });

  it("refuses to integrate over uncommitted local changes, so nothing local is lost", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await writeFile(join(root, SCRIPT_PATH), "local edit();\n");
    await pullScript(root, "two();");
    await expect(integrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "uncommitted-changes",
    });
  });

  it("stops, without committing, when git refuses to start the merge over untracked files", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    // What an interrupted integrate leaves: the pulled files, untracked, and no merge.
    await mkdir(join(root, SCRIPT_PATH, ".."), { recursive: true });
    await writeFile(join(root, SCRIPT_PATH), "one();\n");
    const before = (await git(root, "rev-parse", "HEAD")).trim();
    await expect(integrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "merge-refused",
      message: expect.stringContaining(`1 untracked file(s) would be overwritten: ${SCRIPT_PATH}`),
      hint: expect.stringContaining("delete the untracked files"),
    });
    expect((await git(root, "rev-parse", "HEAD")).trim()).toBe(before);
  });

  it("counts every untracked file in the way, and names the first three", async () => {
    const root = await workspace();
    await pullRows(root, [
      ruleRow("one();"),
      { ...ruleRow("two();"), sys_id: "00000000000000000000000000000002", name: "Other" },
    ]);
    const mirror = (await git(root, "ls-tree", "-r", "--name-only", "servicenow-remote/pdi"))
      .split("\n")
      .filter((path) => path.startsWith("instances/pdi/metadata/"));
    for (const path of mirror) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), "partial");
    }
    await expect(integrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "merge-refused",
      message: expect.stringMatching(
        new RegExp(
          `${mirror.length} untracked file\\(s\\) would be overwritten: [^,]+, [^,]+, [^,]+, \\.\\.\\.$`,
        ),
      ),
    });
  });

  it("takes the instance's copy over a local edit to the mirror, conflicting or not, and names it", async () => {
    const root = await workspace();
    await pullRows(root, [
      ruleRow("one();"),
      { ...ruleRow("two();"), sys_id: "00000000000000000000000000000002", name: "Other" },
    ]);
    await integrator.integrate(root, "pdi");
    const other = SCRIPT_PATH.replace(
      "rule--00000000000000000000000000000001",
      "other--00000000000000000000000000000002",
    );
    await writeFile(join(root, SCRIPT_PATH), "local edit();\n");
    await writeFile(join(root, other), "untouched by the pull();\n");
    await mkdir(join(root, NEW_BASE, ".."), { recursive: true });
    await writeFile(join(root, `${NEW_BASE}.yaml`), "name: Util\n");
    await git(root, "add", "instances");
    await git(root, "commit", "-q", "-m", "edits the mirror should never have had");
    await pullRows(root, [
      ruleRow("remote edit();"),
      { ...ruleRow("two();"), sys_id: "00000000000000000000000000000002", name: "Other" },
    ]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.discarded).toEqual([`${NEW_BASE}.yaml`, other, SCRIPT_PATH].sort());
    expect(await readFile(join(root, SCRIPT_PATH), "utf8")).toBe("remote edit();\n");
    expect(await readFile(join(root, other), "utf8")).toBe("two();\n");
    expect(await Bun.file(join(root, `${NEW_BASE}.yaml`)).exists()).toBe(true);
    expect((await git(root, "ls-files", `${NEW_BASE}.yaml`)).trim()).toBe("");
    expect((await git(root, "log", "-1", "--format=%s")).trim()).toBe("snagentic integrate pdi");
  });

  it("names the records the pull changed with their stamps, for the drift report", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await pullRows(root, [
      {
        ...ruleRow("two();"),
        sys_update_name: "sys_script_00000000000000000000000000000001",
        sys_mod_count: "4",
        sys_updated_on: "2026-10-16 12:00:00",
      },
    ]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.pulled).toEqual([
      {
        updateName: "sys_script_00000000000000000000000000000001",
        modCount: "4",
        updatedOn: "2026-10-16 12:00:00",
      },
    ]);
  });

  it("says the pre-commit check blocked the merge, leaving the merge to finish", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await pullScript(root, "two();");
    const hook = join(root, ".git", "hooks", "pre-commit");
    await mkdir(join(hook, ".."), { recursive: true });
    await writeFile(hook, "#!/bin/sh\necho 'block SN-SEC-001 eval found'\nexit 1\n", {
      mode: 0o755,
    });
    const error = await integrator.integrate(root, "pdi").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "commit-refused" });
    expect(String((error as Error).message)).toContain("SN-SEC-001");
    expect(await Bun.file(join(root, ".git", "MERGE_HEAD")).exists()).toBe(true);
  });
});
