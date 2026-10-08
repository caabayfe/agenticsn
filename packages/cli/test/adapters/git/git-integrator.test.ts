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
import { toYaml } from "../../../src/adapters/yaml/own-style";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const PDI = InstanceName.parse("pdi");
const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata", sys_script_include: "sys_metadata" },
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

// A script include as an agent creates it before pushing: identity and the fields it sets.
async function createLocally(root: string, description: string): Promise<void> {
  await mkdir(join(root, NEW_BASE, ".."), { recursive: true });
  await writeFile(
    join(root, `${NEW_BASE}.yaml`),
    toYaml({
      _meta: { scope: "global", sys_class_name: "sys_script_include", sys_id: NEW_ID },
      active: "false",
      description,
      name: "Util",
    }),
  );
  await writeFile(join(root, `${NEW_BASE}.script.js`), "var Util;\n");
  await git(root, "add", "instances");
  await git(root, "commit", "-q", "-m", "new script include");
}

// The same record as the instance has it after the push, with what the platform fills in.
const pushedRow = (description: string) => ({
  sys_id: NEW_ID,
  sys_class_name: "sys_script_include",
  name: "Util",
  active: "false",
  description,
  api_name: "global.Util",
  access: "package_private",
  script: "var Util;",
});

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
      confirmed: [],
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

  it("reports a conflict when the same record changed locally and on the instance", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await writeFile(join(root, SCRIPT_PATH), "local edit();\n");
    await git(root, "commit", "-q", "-am", "local change");
    await pullScript(root, "remote edit();");
    await expect(integrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "integration-conflicts",
      message: expect.stringContaining("rule--00000000000000000000000000000001.script.js"),
    });
  });

  it("takes the instance's copy of a record pushed from this workspace", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await createLocally(root, "Helpers");
    await pullRows(root, [ruleRow("one();"), pushedRow("Helpers")]);
    const result = await integrator.integrate(root, "pdi");
    expect(result).toMatchObject({ confirmed: [`${NEW_BASE}.yaml`] });
    expect(result.commit).not.toBeNull();
    expect(await readFile(join(root, `${NEW_BASE}.yaml`), "utf8")).toContain(
      "api_name: global.Util",
    );
    expect((await git(root, "status", "--porcelain")).trim()).toBe("");
    expect((await git(root, "log", "-1", "--format=%s")).trim()).toBe("snagentic integrate pdi");
  });

  it("keeps the conflict when the instance's copy differs from what was set locally", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await createLocally(root, "Helpers");
    await pullRows(root, [ruleRow("one();"), pushedRow("Someone else's helpers")]);
    await expect(integrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "integration-conflicts",
      message: expect.stringContaining(`util--${NEW_ID}.yaml`),
    });
  });

  it("resolves a pushed record and reports only the real conflicts", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await writeFile(join(root, SCRIPT_PATH), "local edit();\n");
    await git(root, "commit", "-q", "-am", "local change");
    await createLocally(root, "Helpers");
    await pullRows(root, [ruleRow("remote edit();"), pushedRow("Helpers")]);
    const error = await integrator.integrate(root, "pdi").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "integration-conflicts" });
    expect(String((error as Error).message)).toContain("1 file(s) changed both locally");
    expect(String((error as Error).message)).toContain("took the instance's copy of 1 record");
    expect((await git(root, "diff", "--name-only", "--diff-filter=U")).trim()).toBe(SCRIPT_PATH);
  });
});
