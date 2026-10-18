import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadFluentRuntime } from "../../src/adapters/fluent/fluent-runtime-loader";
import { WorkspaceFluentProjects } from "../../src/adapters/fluent/workspace-fluent-projects";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { executeUseCase } from "../../src/registry/execute";
import { validate } from "../../src/registry/validate";
import { instanceWorkspace } from "../support/instance-workspace";
import { SDK_BUILD_TIMEOUT } from "../support/sdk-contract";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const PROJECT = "source/x_acme_app";
const INCLUDE = `${PROJECT}/src/fluent/util.server.js`;
const SOURCE = `import { ScriptInclude } from '@servicenow/sdk/core'

ScriptInclude({
    $id: Now.ID['util'],
    name: 'Util',
    description: 'Helpers for the acme app',
    apiName: 'x_acme_app.Util',
    script: Now.include('./util.server.js'),
})
`;

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);

// A workspace with one Fluent project, its keys committed, and the mirror integrated.
async function workspace() {
  const ws = await instanceWorkspace({});
  cleanups.push(ws.cleanup);
  const write = async (path: string, content: string) => {
    await mkdir(join(ws.root, path, ".."), { recursive: true });
    await writeFile(join(ws.root, path), content);
  };
  await write("instances/pdi/metadata/global/sys_script/r--b1.yaml", "name: Rule\n");
  await write(
    `${PROJECT}/now.config.json`,
    '{ "scope": "x_acme_app", "scopeId": "24585a3c3484e481f8994b3c68c5d588", "type": "configuration" }\n',
  );
  await write(
    `${PROJECT}/package.json`,
    '{ "name": "x-acme-app", "version": "0.0.1", "private": true }\n',
  );
  await write(`${PROJECT}/src/fluent/util.now.ts`, SOURCE);
  await write(INCLUDE, "var Util = Class.create();\nUtil.prototype = { type: 'Util' };\n");
  const projects = new WorkspaceFluentProjects(ws.root, loadFluentRuntime);
  const [project] = await projects.holding([`${PROJECT}/now.config.json`]);
  if (project === undefined) throw new Error("no project");
  const built = await projects.build(project);
  if (built.built && built.keys !== null) await projects.writeKeys(project, built.keys.built);
  await git(ws.root, "add", ".");
  await git(ws.root, "commit", "-qm", "adopt");
  await git(ws.root, "branch", "servicenow-remote/pdi");
  return { ...ws, write };
}

describe("validate", () => {
  it(
    "passes when nothing changed, without calling the instance",
    async () => {
      const { context, instance } = await workspace();
      const { output, exitCode } = await executeUseCase(validate, {}, context);
      expect(output).toMatchObject({
        instance: "pdi",
        base: "HEAD",
        units: 0,
        fluentProjects: 0,
        passed: true,
      });
      expect(exitCode).toBe(0);
      expect(instance.queries).toEqual([]);
      expect(validate.render(output as never, "text")).toBe("no changed source since HEAD");
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "builds the project, and reports what the edit introduced at the include file's line",
    async () => {
      const { context, write } = await workspace();
      await write(
        INCLUDE,
        "var Util = Class.create();\nUtil.prototype = { type: 'Util' };\neval(code);\n",
      );
      const { output, exitCode } = await executeUseCase(validate, {}, context);
      expect(output).toMatchObject({
        units: 1,
        fluentProjects: 1,
        passed: false,
        findings: [{ ruleId: "SN-SEC-001", path: INCLUDE, root: "workspace", line: 3 }],
      });
      expect(exitCode).toBe(1);
      const text = validate.render(output as never, "text");
      expect(text).toContain(`block SN-SEC-001  ${INCLUDE}:3`);
      expect(text).toContain(
        "1 unit(s) in 1 project(s) checked against HEAD: 1 block, 0 warn, 0 info",
      );
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "refuses an edit to the mirror",
    async () => {
      const { context, write } = await workspace();
      await write("instances/pdi/metadata/global/sys_script/r--b1.yaml", "name: Edited\n");
      const { output } = await executeUseCase(validate, {}, context);
      expect(output).toMatchObject({
        passed: false,
        findings: [
          { ruleId: "SN-MNT-013", path: "instances/pdi/metadata/global/sys_script/r--b1.yaml" },
        ],
      });
    },
    SDK_BUILD_TIMEOUT,
  );

  it(
    "checks the projects holding the paths it is given, and nothing for other paths",
    async () => {
      const { context, write, root } = await workspace();
      await write(INCLUDE, "var Util = Class.create();\neval(code);\n");
      const given = await executeUseCase(validate, { paths: [join(root, INCLUDE)] }, context);
      expect(given.output).toMatchObject({ fluentProjects: 1, passed: false });
      const elsewhere = await executeUseCase(validate, { paths: ["README.md"] }, context);
      expect(elsewhere.output).toMatchObject({ fluentProjects: 0, passed: true });
    },
    SDK_BUILD_TIMEOUT,
  );

  it("lists what it did not check", () => {
    const text = validate.render(
      {
        instance: "pdi",
        base: "HEAD",
        units: 1,
        fluentProjects: 1,
        passed: true,
        counts: { block: 0, warn: 0, info: 0 },
        findings: [],
        inherited: 2,
        notChecked: [{ path: "big.server.js", reason: "over 512000 bytes" }],
        rulesNotChecked: [],
      },
      "text",
    );
    expect(text).toContain("not checked: big.server.js (over 512000 bytes)");
    expect(text).toContain("2 inherited (not blocking)");
  });
});
