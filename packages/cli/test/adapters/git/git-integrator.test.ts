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

const RULE_BASE = "global/sys_script/rule--00000000000000000000000000000001";
const FIELDS_FILE = `${RULE_BASE}.children.sys_ui_element.yaml`;
const fieldRow = (n: number, element: string) => ({
  sys_id: `${n}`.repeat(32),
  sys_ui_section: "00000000000000000000000000000001",
  element,
});
// As pull writes a row: with the platform's provenance.
const pulledField = (n: number, element: string) => ({
  ...fieldRow(n, element),
  sys_created_on: "2026-10-13 10:00:00",
  sys_mod_count: "0",
});

// A pull that finds the rule and these child rows (ADR-0025).
async function pullWithFields(root: string, rows: readonly Record<string, string>[]) {
  const mirror = await GitMirror.open(root, PDI, "fresh");
  await mirror.write(
    "instances/pdi/metadata",
    renderRecord(artifactFromRow(ruleRow("one();"), catalog, DEFAULT_REDACTION), catalog),
  );
  await mirror.writeDocument("instances/pdi/metadata", FIELDS_FILE, rows);
  await mirror.finish("pull");
}

async function addFieldsLocally(root: string, rows: readonly Record<string, string>[]) {
  await writeFile(join(root, "instances/pdi/metadata", FIELDS_FILE), toYaml(rows));
  await git(root, "add", "instances");
  await git(root, "commit", "-q", "-m", "fields");
}

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);
const integrator = gitIntegrator;

const NEW_ID = "4944d956393ce479c7b489974061fefd";
const NEW_BASE = `instances/pdi/metadata/global/sys_script_include/util--${NEW_ID}`;

// A script include as an agent creates it before pushing: identity and the fields it sets.
async function createLocally(root: string, description: string, script = "var Util;\n") {
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
  await writeFile(join(root, `${NEW_BASE}.script.js`), script);
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
      hint: expect.stringContaining("commit"),
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

  it("takes the instance's copy when only a script's trailing newline differs", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await createLocally(root, "Helpers", "var Util;");
    await pullRows(root, [ruleRow("one();"), pushedRow("Helpers")]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.confirmed).toEqual([`${NEW_BASE}.yaml`]);
    expect(await readFile(join(root, `${NEW_BASE}.script.js`), "utf8")).toBe("var Util;\n");
    expect((await git(root, "status", "--porcelain")).trim()).toBe("");
  });

  it("takes the instance's copy of a pushed property whose value pull withholds", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    const base = `instances/pdi/metadata/global/sys_properties/u-reminder-minutes--${NEW_ID}`;
    await mkdir(join(root, base, ".."), { recursive: true });
    const property = { name: "u.reminder_minutes", type: "integer", value: "15" };
    const meta = { scope: "global", sys_class_name: "sys_properties", sys_id: NEW_ID };
    await writeFile(join(root, `${base}.yaml`), toYaml({ _meta: meta, ...property }));
    await git(root, "add", "instances");
    await git(root, "commit", "-q", "-m", "new property");
    const row = { sys_id: NEW_ID, sys_class_name: "sys_properties", ...property };
    await pullRows(root, [ruleRow("one();"), { ...row, sys_name: "u.reminder_minutes" }]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.confirmed).toEqual([`${base}.yaml`]);
    expect(await readFile(join(root, `${base}.yaml`), "utf8")).not.toContain("15");
  });

  it("keeps the instance's file name for a record pushed from here under another name", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await createLocally(root, "Helpers");
    const renamed = `instances/pdi/metadata/global/sys_script_include/escalation-helpers--${NEW_ID}`;
    await pullRows(root, [
      ruleRow("one();"),
      { ...pushedRow("Helpers"), sys_name: "Escalation helpers" },
    ]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.confirmed).toEqual([`${renamed}.yaml`]);
    const files = await git(root, "ls-files", "instances/pdi/metadata/global/sys_script_include");
    expect(files.trim().split("\n")).toEqual([`${renamed}.script.js`, `${renamed}.yaml`]);
    expect((await git(root, "status", "--porcelain")).trim()).toBe("");
    expect((await git(root, "log", "-1", "--format=%s")).trim()).toBe("snagentic integrate pdi");
  });

  it("stops, naming both files, when a record pulled under another name differs locally", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await createLocally(root, "Helpers");
    await pullRows(root, [
      ruleRow("one();"),
      { ...pushedRow("Changed there"), sys_name: "Escalation helpers" },
    ]);
    const error = await integrator.integrate(root, "pdi").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "integration-conflicts" });
    expect(String((error as Error).message)).toContain(`util--${NEW_ID}.yaml`);
    expect(String((error as Error).message)).toContain(`escalation-helpers--${NEW_ID}.yaml`);
    expect(error).toMatchObject({
      hint: expect.stringContaining("keep the instance's file, copy any local change into it"),
    });
  });

  it("takes the instance's child rows when they confirm the rows added here (ADR-0025)", async () => {
    const root = await workspace();
    await pullWithFields(root, [pulledField(1, "number")]);
    await integrator.integrate(root, "pdi");
    await addFieldsLocally(root, [pulledField(1, "number"), fieldRow(2, "decision")]);
    await pullWithFields(root, [pulledField(1, "number"), pulledField(2, "decision")]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.confirmed).toEqual([`instances/pdi/metadata/${FIELDS_FILE}`]);
    expect(await readFile(join(root, "instances/pdi/metadata", FIELDS_FILE), "utf8")).toContain(
      "sys_created_on",
    );
    expect((await git(root, "status", "--porcelain")).trim()).toBe("");
  });

  it("takes a new child file the instance confirms, added on both sides", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await integrator.integrate(root, "pdi");
    await addFieldsLocally(root, [fieldRow(2, "decision")]);
    await pullWithFields(root, [pulledField(2, "decision")]);
    const result = await integrator.integrate(root, "pdi");
    expect(result.confirmed).toEqual([`instances/pdi/metadata/${FIELDS_FILE}`]);
  });

  it("keeps the conflict when the instance's rows differ from the rows set here", async () => {
    const root = await workspace();
    await pullWithFields(root, [pulledField(1, "number")]);
    await integrator.integrate(root, "pdi");
    await addFieldsLocally(root, [pulledField(1, "number"), fieldRow(2, "decision")]);
    await pullWithFields(root, [pulledField(1, "number"), pulledField(2, "state")]);
    await expect(integrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "integration-conflicts",
    });
  });

  it("moves a renamed record's child rows with it only when the instance confirms them", async () => {
    const renamed = `global/sys_script_include/escalation-helpers--${NEW_ID}`;
    const local = `${NEW_BASE}.children.sys_ui_element.yaml`;
    const pullRenamed = async (root: string, element: string) => {
      const mirror = await GitMirror.open(root, PDI, "fresh");
      for (const row of [
        ruleRow("one();"),
        { ...pushedRow("Helpers"), sys_name: "Escalation helpers" },
      ]) {
        await mirror.write(
          "instances/pdi/metadata",
          renderRecord(artifactFromRow(row, catalog, DEFAULT_REDACTION), catalog),
        );
      }
      await mirror.writeDocument(
        "instances/pdi/metadata",
        `${renamed}.children.sys_ui_element.yaml`,
        [pulledField(2, element)],
      );
      await mirror.finish("pull");
    };
    for (const [element, confirmed] of [
      ["decision", true],
      ["state", false],
    ] as const) {
      const root = await workspace();
      await pullScript(root, "one();");
      await integrator.integrate(root, "pdi");
      await createLocally(root, "Helpers");
      await writeFile(join(root, local), toYaml([fieldRow(2, "decision")]));
      await git(root, "add", "instances");
      await git(root, "commit", "-q", "-m", "fields");
      await pullRenamed(root, element);
      const outcome = await integrator.integrate(root, "pdi").catch((e: unknown) => e);
      expect(outcome).toMatchObject(
        confirmed ? { confirmed: [expect.any(String)] } : { code: "integration-conflicts" },
      );
      expect(await Bun.file(join(root, local)).exists()).toBe(!confirmed);
    }
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
