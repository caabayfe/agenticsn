import { describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FluentKeysUnstagedError } from "@snagentic/core";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";
import { WorkspaceFluentProjects } from "../../../src/adapters/fluent/workspace-fluent-projects";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
import { fluentWorkspace, KEYS_FILE } from "../../support/fluent-fixtures";

const BUILD_TIMEOUT = 60_000;
const git = (root: string, ...args: string[]) => runGitOrThrow(args, root);
const property = (id: string) =>
  `import { Property } from '@servicenow/sdk/core'\n\nProperty({ $id: Now.ID['${id}'], name: 'x_2222332_s11.${id}', value: 'on' })\n`;
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
      const build = await projects.build(project);
      expect(build).toMatchObject({ built: true, keys: null, deletes: [] });
      // The units validate checks, the project's flow among them.
      expect(build.built && build.units.map((unit) => unit.head.table)).toContain("sys_hub_flow");
      expect((await runGitOrThrow(["status", "--porcelain"], root)).trim()).toBe("");
      // As the last commit held it, and nothing for a commit before the project existed.
      const head = (await runGitOrThrow(["rev-parse", "HEAD"], root)).trim();
      expect(await projects.buildAt(project, head)).toMatchObject({ built: true, keys: null });
      const empty = (
        await runGitOrThrow(
          [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit-tree",
            "-m",
            "empty",
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
          ],
          root,
        )
      ).trim();
      expect(await projects.buildAt(project, empty)).toBeNull();
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
      expect(build).toMatchObject({
        built: true,
        keys: { built: expect.stringContaining("extra") },
      });
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

  it(
    "writes a build's keys into the project, and only there, when not staged",
    async () => {
      const { root, projects } = await workspace();
      writeFileSync(join(root, PROJECT, "src/fluent/extra.now.ts"), property("extra"));
      const [project] = await projects.changedSince("HEAD");
      if (project === undefined) throw new Error("no project");
      const build = await projects.build(project);
      if (!build.built || build.keys === null) throw new Error("no new keys");
      await projects.writeKeys(project, build.keys.built);
      expect(readFileSync(join(root, PROJECT, KEYS_FILE), "utf8")).toBe(build.keys.built);
      expect(await projects.build(project)).toMatchObject({ keys: null });
      // Nothing staged: the user commits it.
      expect(await git(root, "diff", "--cached", "--name-only")).toBe("");
    },
    BUILD_TIMEOUT,
  );

  it(
    "staged, builds the commit as the index holds it, and stages only that commit's keys",
    async () => {
      const { root } = await workspace();
      const staged = new WorkspaceFluentProjects(root, loadFluentRuntime, { staged: true });
      // Two new properties; only one goes into this commit.
      writeFileSync(join(root, PROJECT, "src/fluent/in.now.ts"), property("in_commit"));
      writeFileSync(join(root, PROJECT, "src/fluent/out.now.ts"), property("left_out"));
      await git(root, "add", `${PROJECT}/src/fluent/in.now.ts`);
      const [project] = await staged.changedSince("HEAD");
      if (project === undefined) throw new Error("no project");
      const build = await staged.build(project);
      if (!build.built || build.keys === null) throw new Error("no new keys");
      expect(build.keys.built).toContain("in_commit");
      expect(build.keys.built).not.toContain("left_out");
      await staged.writeKeys(project, build.keys.built);
      expect((await git(root, "diff", "--cached", "--name-only")).trim().split("\n")).toEqual([
        `${PROJECT}/src/fluent/generated/keys.ts`,
        `${PROJECT}/src/fluent/in.now.ts`,
      ]);
      expect(await staged.build(project)).toMatchObject({ keys: null, deletes: [] });
    },
    BUILD_TIMEOUT,
  );

  it("staged, sees no project without staged changes", async () => {
    const { root } = await workspace();
    writeFileSync(join(root, PROJECT, "src/fluent/extra.now.ts"), property("extra"));
    const staged = new WorkspaceFluentProjects(root, loadFluentRuntime, { staged: true });
    expect(await staged.changedSince("HEAD")).toEqual([]);
  });

  it("staged, refuses to overwrite keys.ts edits that are not staged", async () => {
    const { root } = await workspace();
    const keys = join(root, PROJECT, KEYS_FILE);
    writeFileSync(keys, `${readFileSync(keys, "utf8")}// mine\n`);
    const staged = new WorkspaceFluentProjects(root, loadFluentRuntime, { staged: true });
    const project = { path: PROJECT, declaredSdk: "4.13.6" };
    await expect(staged.writeKeys(project, "new")).rejects.toThrow(FluentKeysUnstagedError);
    expect(readFileSync(keys, "utf8")).toEndWith("// mine\n");
  });

  it("names the SDK version it builds with", async () => {
    const { projects } = await workspace();
    expect(await projects.sdkVersion()).toBe("4.13.6");
  });
});
