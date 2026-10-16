import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { EslintScriptChecker } from "../../../src/adapters/governance/eslint-script-checker";
import { GitMirrorState } from "../../../src/adapters/governance/git-mirror-state";
import { toYaml } from "../../../src/adapters/yaml/own-style";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const ROOT = "instances/pdi/metadata";
const INCLUDE = "global/sys_script_include/util--s1";
const git = (repo: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], repo);

async function workspace() {
  const repo = await mkdtemp(join(tmpdir(), "snagentic-validate-"));
  temporary.push(repo);
  await runGitOrThrow(["init", "-q", "-b", "main"], repo);
  const write = async (path: string, content: string) => {
    await mkdir(join(repo, ROOT, path, ".."), { recursive: true });
    await writeFile(join(repo, ROOT, path), content);
  };
  await write(
    `${INCLUDE}.yaml`,
    toYaml({
      _meta: { sys_id: "s1", sys_class_name: "sys_script_include", scope: "x_acme" },
      name: "Util",
      description: "Helpers",
    }),
  );
  await write(`${INCLUDE}.script.js`, "var Util = Class.create();\n");
  await write(`${INCLUDE}.children.sys_x.yaml`, "rows: []\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-qm", "pull");
  return { repo, write, records: new GitMirrorState(repo, ROOT, "servicenow-remote/pdi") };
}

describe("GitMirrorState (ADR-0031 item 2)", () => {
  // The instance's mirror branch at the commit the branch integrated.
  async function integrated() {
    const ws = await workspace();
    await git(ws.repo, "branch", "servicenow-remote/pdi");
    return ws;
  }

  it("resolves refs to commits, and nothing for an unknown ref", async () => {
    const { repo, records } = await workspace();
    expect(await records.resolve("HEAD")).toMatch(/^[0-9a-f]{40}$/);
    expect(await records.resolve("nope")).toBeNull();
    expect(await new GitMirrorState(repo, ROOT, "servicenow-remote/pdi").edited()).toEqual([]);
  });

  it("names mirror files the workspace changed since the integrated copy, added ones too", async () => {
    const { repo, write, records } = await integrated();
    expect(await records.edited()).toEqual([]);
    await write(`${INCLUDE}.script.js`, "var Util = 1;\n");
    await write("global/sys_script/new--s2.yaml", "name: x\n");
    await mkdir(join(repo, "source/x"), { recursive: true });
    await writeFile(join(repo, "source/x/a.now.ts"), "x\n");
    expect(await records.edited()).toEqual([
      `${ROOT}/global/sys_script/new--s2.yaml`,
      `${ROOT}/${INCLUDE}.script.js`,
    ]);
  });

  it("does not count a pull the branch has not integrated as an edit", async () => {
    const { repo, records } = await integrated();
    await git(repo, "switch", "-q", "servicenow-remote/pdi");
    await writeFile(join(repo, ROOT, `${INCLUDE}.script.js`), "var Util = 2;\n");
    await git(repo, "commit", "-qam", "pull");
    await git(repo, "switch", "-q", "main");
    expect(await records.edited()).toEqual([]);
  });

  it("while integrate merges the instance, compares with the copy it is merging", async () => {
    const { repo } = await integrated();
    await git(repo, "switch", "-q", "servicenow-remote/pdi");
    await writeFile(join(repo, ROOT, `${INCLUDE}.script.js`), "var Util = 2;\n");
    await git(repo, "commit", "-qam", "pull");
    await git(repo, "switch", "-q", "main");
    await git(repo, "merge", "--no-ff", "--no-commit", "servicenow-remote/pdi");
    const staged = new GitMirrorState(repo, ROOT, "servicenow-remote/pdi", { staged: true });
    expect(await staged.edited()).toEqual([]);
    await writeFile(join(repo, ROOT, `${INCLUDE}.script.js`), "var Util = 3;\n");
    await git(repo, "add", ".");
    expect(await staged.edited()).toEqual([`${ROOT}/${INCLUDE}.script.js`]);
  });
});

describe("GitMirrorState: cross-scope privileges", () => {
  const FOLDER = "x_acme/sys_scope_privilege";
  const privilege = (fields: Record<string, string>) =>
    toYaml({
      _meta: { sys_id: "p1", sys_class_name: "sys_scope_privilege", scope: "x_acme" },
      operation: "read",
      target_scope: "global",
      ...fields,
    });

  it("lists the allowed privileges an application declares, in the workspace and as staged", async () => {
    const { repo, write } = await workspace();
    await write(
      `${FOLDER}/sys-user--p1.yaml`,
      privilege({ target_type: "sys_db_object", target_name: "sys_user", status: "allowed" }),
    );
    // An agent's new privilege, without the status the platform defaults to allowed.
    await write(
      `${FOLDER}/remover--p2.yaml`,
      privilege({ target_type: "sys_script_include", target_name: "Remover" }),
    );
    await write(
      `${FOLDER}/role--p3.yaml`,
      privilege({ target_type: "sys_db_object", target_name: "sys_user_role", status: "denied" }),
    );
    const records = new GitMirrorState(repo, ROOT, "servicenow-remote/pdi");
    expect([...(await records.privileges("x_acme"))].sort()).toEqual([
      "sys_db_object:sys_user",
      "sys_script_include:Remover",
    ]);
    expect(await records.privileges("x_other")).toEqual([]);
    await git(repo, "add", `${ROOT}/${FOLDER}/sys-user--p1.yaml`);
    const staged = new GitMirrorState(repo, ROOT, "servicenow-remote/pdi", { staged: true });
    expect(await staged.privileges("x_acme")).toEqual(["sys_db_object:sys_user"]);
  });
});

describe("EslintScriptChecker", () => {
  const context = {
    className: "sys_script",
    kind: "server" as const,
    scoped: false,
    when: "before",
    type: "",
    name: "",
    scope: "global",
    privileges: [],
  };

  it("passes a scoped script's declared privileges to the rules", () => {
    const scoped = { ...context, scoped: true, scope: "x_acme" };
    const source = "var u = new GlideRecord('sys_user');";
    expect(new EslintScriptChecker().check(source, ["SN-MNT-008"], scoped)).toMatchObject({
      hits: [{ ruleId: "SN-MNT-008", line: 1 }],
    });
    const declared = { ...scoped, privileges: ["sys_db_object:sys_user"] };
    expect(new EslintScriptChecker().check(source, ["SN-MNT-008"], declared)).toEqual({
      parsed: true,
      hits: [],
    });
  });

  it("reports the requested rules' hits with their ids and lines", () => {
    const result = new EslintScriptChecker().check(
      "var a = 1;\ncurrent.update();\neval(a);",
      ["SN-PERF-001"],
      context,
    );
    expect(result).toEqual({
      parsed: true,
      hits: [{ ruleId: "SN-PERF-001", line: 2, message: expect.any(String) }],
    });
  });

  it("reports a script that does not parse, with the line", () => {
    expect(new EslintScriptChecker().check("var a = ;", [], context)).toMatchObject({
      parsed: false,
      line: 1,
    });
  });

  it("accepts a top-level return, which the platform allows in wrapped scripts", () => {
    expect(new EslintScriptChecker().check("if (a) { return; }", [], context)).toEqual({
      parsed: true,
      hits: [],
    });
  });

  it("reads a portal client script as the function expression the platform evaluates", () => {
    const portal = { ...context, className: "sp_widget", kind: "portal_client" as const };
    for (const source of [
      "function($scope) {\n  alert('x');\n}",
      "function() {\n  alert('x');\n};\n",
    ]) {
      expect(new EslintScriptChecker().check(source, ["SN-UX-003"], portal)).toMatchObject({
        parsed: true,
        hits: [{ ruleId: "SN-UX-003", line: 2 }],
      });
    }
    expect(
      new EslintScriptChecker().check(
        "function($scope) {\n  alert('x');\n}",
        ["SN-UX-003"],
        portal,
      ),
    ).toEqual({
      parsed: true,
      hits: [{ ruleId: "SN-UX-003", line: 2, message: expect.any(String) }],
    });
  });

  it("ignores inline ESLint comments in platform scripts", () => {
    expect(
      new EslintScriptChecker().check(
        '/* eslint no-undef: "error" */\n/* global foo */\nfoo(); // eslint-disable-line sn/SN-SEC-001\neval(a);',
        ["SN-SEC-001"],
        context,
      ),
    ).toEqual({
      parsed: true,
      hits: [{ ruleId: "SN-SEC-001", line: 4, message: expect.any(String) }],
    });
  });

  it("ignores rule ids the pack does not implement", () => {
    expect(new EslintScriptChecker().check("x();", ["SN-UPG-002"], context)).toEqual({
      parsed: true,
      hits: [],
    });
  });
});
