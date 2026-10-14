import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { EslintScriptChecker } from "../../../src/adapters/governance/eslint-script-checker";
import { GitChangedRecords } from "../../../src/adapters/governance/git-changed-records";
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
  return { repo, write, records: new GitChangedRecords(repo, ROOT, "servicenow-remote/pdi") };
}

describe("GitChangedRecords", () => {
  it("resolves refs to commits, and nothing for an unknown ref", async () => {
    const { records } = await workspace();
    expect(await records.resolve("HEAD")).toMatch(/^[0-9a-f]{40}$/);
    expect(await records.resolve("no-such-branch")).toBeNull();
  });

  it("names the instance's commit while integrate merges it, and nothing otherwise", async () => {
    const { repo, records, write } = await workspace();
    expect(await records.mirrorMerge()).toBeNull();
    await git(repo, "branch", "servicenow-remote/pdi");
    await git(repo, "branch", "feature");
    await git(repo, "switch", "-q", "servicenow-remote/pdi");
    await write("global/sys_script/pulled--b3.yaml", "name: Pulled\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "pull");
    const pulled = await records.resolve("HEAD");
    await git(repo, "switch", "-q", "feature");
    await write("global/sys_script/mine--b4.yaml", "name: Mine\n");
    await git(repo, "add", ".");
    await git(repo, "commit", "-qm", "mine");
    await git(repo, "switch", "-q", "main");
    await git(repo, "merge", "--no-ff", "--no-commit", "feature");
    expect(await records.mirrorMerge()).toBeNull();
    await git(repo, "merge", "--abort");
    await git(repo, "merge", "--no-ff", "--no-commit", "servicenow-remote/pdi");
    expect(await records.mirrorMerge()).toBe(pulled);
  });

  it("lists records edited or added since a commit", async () => {
    const { records, write } = await workspace();
    const head = (await records.resolve("HEAD")) ?? "";
    expect(await records.changedSince(head)).toEqual([]);
    await write(`${INCLUDE}.script.js`, "var Util = Class.create();\neval(x);\n");
    await write("global/sys_script/new--b2.yaml", "name: New\n");
    expect(await records.changedSince(head)).toEqual(["global/sys_script/new--b2", INCLUDE]);
  });

  it("reads a record now and at a commit, with its scripts but not its child rows", async () => {
    const { records, write } = await workspace();
    const head = (await records.resolve("HEAD")) ?? "";
    await write(`${INCLUDE}.script.js`, "eval(x);\n");
    expect(await records.current(INCLUDE)).toEqual({
      className: "sys_script_include",
      scope: "x_acme",
      fields: { name: "Util", description: "Helpers", script: "eval(x);\n" },
      files: { script: `${INCLUDE}.script.js` },
    });
    expect((await records.at(head, INCLUDE))?.fields["script"]).toBe(
      "var Util = Class.create();\n",
    );
    expect(await records.at(head, "global/sys_script/none--x")).toBeNull();
    expect(await records.current("global/sys_script/none--x")).toBeNull();
  });
});

describe("GitChangedRecords: staged (the pre-commit hook)", () => {
  it("checks what is being committed: the index, not untracked files or unstaged edits", async () => {
    const { repo, write } = await workspace();
    const staged = new GitChangedRecords(repo, ROOT, "servicenow-remote/pdi", { staged: true });
    await write(`${INCLUDE}.script.js`, "var Util = Class.create(); // staged\n");
    await git(repo, "add", ".");
    await write(`${INCLUDE}.script.js`, "var Util = Class.create(); // not staged\n");
    await write("global/sys_script/untracked--u1.yaml", "name: Untracked\n");
    expect(await staged.changedSince("HEAD")).toEqual([INCLUDE]);
    expect((await staged.current(INCLUDE))?.fields["script"]).toContain("// staged");
  });
});

describe("GitChangedRecords: references", () => {
  const ROLE = "global/sys_security_acl_role/incident-itil--r1";
  const role = (acl: string) =>
    toYaml({
      _meta: { sys_id: "r1", sys_class_name: "sys_security_acl_role", scope: "global" },
      sys_security_acl: acl,
      sys_user_role: "itil1",
    });

  it("counts the records pointing at a sys_id, now and at a commit", async () => {
    const { records, write } = await workspace();
    await write(`${ROLE}.yaml`, role("a1c"));
    const head = (await records.resolve("HEAD")) ?? "";
    // Not committed yet: the workspace has the role, the commit does not.
    expect(
      await records.countReferences("sys_security_acl_role", "sys_security_acl", "a1c", null),
    ).toBe(1);
    expect(
      await records.countReferences("sys_security_acl_role", "sys_security_acl", "a1c", head),
    ).toBe(0);
    expect(
      await records.countReferences("sys_security_acl_role", "sys_security_acl", "a1", null),
    ).toBe(0);
  });

  it("counts a reference however the YAML quotes it", async () => {
    const { records, write } = await workspace();
    await write(`${ROLE}.yaml`, "sys_security_acl: 'a1c'\n");
    await write("global/sys_security_acl_role/other--r2.yaml", 'sys_security_acl: "a1c"\n');
    expect(
      await records.countReferences("sys_security_acl_role", "sys_security_acl", "a1c", null),
    ).toBe(2);
  });

  it("reports a git failure instead of counting nothing", async () => {
    const { records } = await workspace();
    await expect(
      records.countReferences("sys_security_acl_role", "sys_security_acl", "a1c", "f".repeat(40)),
    ).rejects.toThrow();
  });
});

describe("GitChangedRecords: cross-scope privileges", () => {
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
    const records = new GitChangedRecords(repo, ROOT, "servicenow-remote/pdi");
    expect([...(await records.privileges("x_acme"))].sort()).toEqual([
      "sys_db_object:sys_user",
      "sys_script_include:Remover",
    ]);
    expect(await records.privileges("x_other")).toEqual([]);
    await git(repo, "add", `${ROOT}/${FOLDER}/sys-user--p1.yaml`);
    const staged = new GitChangedRecords(repo, ROOT, "servicenow-remote/pdi", { staged: true });
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
