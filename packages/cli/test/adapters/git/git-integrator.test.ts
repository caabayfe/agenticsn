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
  parents: { sys_metadata: null, sys_script: "sys_metadata" },
  scopes: {},
  typedFields: { sys_script: { script: "script_server" } },
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

async function pullScript(root: string, script: string): Promise<void> {
  const mirror = await GitMirror.open(root, PDI, "fresh");
  const row = {
    sys_id: "00000000000000000000000000000001",
    sys_class_name: "sys_script",
    name: "Rule",
    script,
  };
  await mirror.write(
    "instances/pdi/metadata",
    renderRecord(artifactFromRow(row, catalog, DEFAULT_REDACTION), catalog),
  );
  await mirror.finish("pull");
}

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);
const integrator = gitIntegrator;

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
    expect(await integrator.integrate(root, "pdi")).toEqual({ commit: null, changedFiles: 0 });
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
});
