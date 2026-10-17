import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceAuthoring } from "../../src/adapters/fluent/workspace-authoring";
import { runGit } from "../../src/adapters/git/run-git";
import { FsWorkspaceStore } from "../../src/adapters/workspace/fs-workspace-store";
import { executeUseCase } from "../../src/registry/execute";
import { init } from "../../src/registry/init";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "../support/fakes";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function contextIn(): Promise<UseCaseContext> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "snagentic-init-")));
  temporary.push(base);
  return {
    ...FAKE_CONTEXT,
    workspaces: new FsWorkspaceStore(),
    authoring: (root: string) => ({
      workspace: new WorkspaceAuthoring(root, runtime),
      toolchain: FAKE_CONTEXT.authoring(root).toolchain,
    }),
    host: { cwd: join(base, "cwd"), home: join(base, "home"), version: "snagentic test" },
  };
}

const runtime = async () => ({
  sdkVersion: "4.13.6",
  build: async () => ({ success: true as const, records: [] }),
  transform: async () => ({ success: false as const, message: "unused" }),
});

describe("init use case", () => {
  it("creates a workspace at the given absolute path", async () => {
    const context = await contextIn();
    const root = join(context.host.home, "data", "acme");
    const { output } = await executeUseCase(init, { path: root }, context);
    expect(output).toMatchObject({ root, layout: 2 });
    expect(await new FsWorkspaceStore().readManifest(root)).toMatchObject({ layout: 2 });
    // Global changes have a Fluent project from the start (ADR-0031).
    expect(
      JSON.parse(await Bun.file(join(root, "source/global/now.config.json")).text()),
    ).toMatchObject({
      scope: "global",
      type: "configuration",
    });
    expect((await runGit(["status", "--porcelain"], root)).stdout).toBe("");
  });

  it("suggests ~/snagentic/<name> when no path is given", async () => {
    const context = await contextIn();
    const { output } = await executeUseCase(init, { name: "acme" }, context);
    expect(output["root"]).toBe(join(context.host.home, "snagentic", "acme"));
  });

  it("expands ~ and resolves relative paths against the current folder", async () => {
    const context = await contextIn();
    const home = await executeUseCase(init, { path: "~/w1" }, context);
    const relative = await executeUseCase(init, { path: "w2" }, context);
    expect([home.output["root"], relative.output["root"]]).toEqual([
      join(context.host.home, "w1"),
      join(context.host.cwd, "w2"),
    ]);
  });

  it("refuses to create a workspace inside another repository (exit 3)", async () => {
    const context = await contextIn();
    const repository = join(context.host.home, "code");
    await new FsWorkspaceStore().create(repository, { layout: 2, createdWith: "x" });
    await runGit(["init", "-q"], repository);
    const error = await executeUseCase(init, { path: join(repository, "data") }, context).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ code: "nested-repository", category: "precondition" });
  });

  it("renders where the workspace is and what to do next", () => {
    const text = init.render({ root: "/w/acme", layout: 2, nextSteps: ["cd /w/acme"] }, "text");
    expect(text).toBe("workspace created at /w/acme (layout 2)\nnext:\n  cd /w/acme");
  });
});
