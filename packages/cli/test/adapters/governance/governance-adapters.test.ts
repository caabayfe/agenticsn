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
  return { repo, write, records: new GitChangedRecords(repo, ROOT) };
}

describe("GitChangedRecords", () => {
  it("resolves refs to commits, and nothing for an unknown ref", async () => {
    const { records } = await workspace();
    expect(await records.resolve("HEAD")).toMatch(/^[0-9a-f]{40}$/);
    expect(await records.resolve("no-such-branch")).toBeNull();
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

describe("EslintScriptChecker", () => {
  const context = {
    className: "sys_script",
    kind: "server" as const,
    scoped: false,
    when: "before",
    type: "",
    name: "",
  };

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
