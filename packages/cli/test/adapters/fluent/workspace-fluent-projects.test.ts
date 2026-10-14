import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import { WorkspaceFluentProjects } from "../../../src/adapters/fluent/workspace-fluent-projects";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { fluentWorkspace, KEYS_FILE } from "../../support/fluent-fixtures";

const BUILD_TIMEOUT = 60_000;
const PROJECT = "source/x_2222332_s11";

async function workspace(): Promise<{ root: string; projects: WorkspaceFluentProjects }> {
  const root = await fluentWorkspace(PROJECT);
  return { root, projects: new WorkspaceFluentProjects(root, loadFluentRuntime) };
}

describe("workspace Fluent projects", () => {
  it("finds the projects with a file changed or added since a commit", async () => {
    const { root, projects } = await workspace();
    expect(await projects.changedSince("HEAD")).toEqual([]);
    writeFileSync(join(root, PROJECT, "src/fluent/extra.now.ts"), "export {}\n");
    expect(await projects.changedSince("HEAD")).toEqual([{ path: PROJECT, declaredSdk: "4.13.6" }]);
  });

  it("knows only folders under source/ with a now.config.json as projects", async () => {
    const { projects } = await workspace();
    expect(
      await projects.holding([
        `${PROJECT}/src/fluent/s11-flow.now.ts`,
        "source/x_none/a.ts",
        "x/y",
      ]),
    ).toEqual([{ path: PROJECT, declaredSdk: "4.13.6" }]);
  });

  it(
    "builds a committed project in a copy: nothing to commit, nothing deleted, workspace untouched",
    async () => {
      const { root, projects } = await workspace();
      const [project] = await projects.holding([`${PROJECT}/package.json`]);
      if (project === undefined) throw new Error("no project");
      expect(await projects.build(project)).toEqual({
        built: true,
        keysChanged: false,
        deletes: [],
      });
      expect((await runGitOrThrow(["status", "--porcelain"], root)).trim()).toBe("");
    },
    BUILD_TIMEOUT,
  );

  it(
    "reports new IDs to commit and the records a build would delete",
    async () => {
      const { root, projects } = await workspace();
      const keys = join(root, PROJECT, KEYS_FILE);
      // A key the source no longer uses: the SDK deletes its record.
      writeFileSync(
        keys,
        readFileSync(keys, "utf8").replace(
          "explicit: {",
          "explicit: {\n                    gone_property: {\n                        table: 'sys_properties'\n                        id: '0123456789abcdef0123456789abcdef'\n                    }",
        ),
      );
      writeFileSync(
        join(root, PROJECT, "src/fluent/extra.now.ts"),
        "import { Property } from '@servicenow/sdk/core'\n\nProperty({ $id: Now.ID['extra'], name: 'x_2222332_s11.extra', value: 'on' })\n",
      );
      const [project] = await projects.holding([`${PROJECT}/package.json`]);
      if (project === undefined) throw new Error("no project");
      const build = await projects.build(project);
      expect(build).toMatchObject({ built: true, keysChanged: true });
      expect(build.built && build.deletes).toEqual([
        "sys_properties_0123456789abcdef0123456789abcdef",
      ]);
    },
    BUILD_TIMEOUT,
  );

  it(
    "returns the build's errors",
    async () => {
      const { root, projects } = await workspace();
      writeFileSync(
        join(root, PROJECT, "src/fluent/broken.now.ts"),
        "import { action } from '@servicenow/sdk/automation'\n\nexport const x = action.core.updateRecordz\n",
      );
      const [project] = await projects.holding([`${PROJECT}/package.json`]);
      if (project === undefined) throw new Error("no project");
      const build = await projects.build(project);
      expect(build.built).toBe(false);
      expect(!build.built && build.errors[0]).toMatchObject({
        file: "src/fluent/broken.now.ts",
        code: "ts2551",
      });
    },
    BUILD_TIMEOUT,
  );

  it("names the SDK version it builds with", async () => {
    const { projects } = await workspace();
    expect(await projects.sdkVersion()).toBe("4.13.6");
  });
});
