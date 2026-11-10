import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstanceName } from "@snagentic/core";
import { GitDeliveryWorkspace } from "../../../src/adapters/delivery/git-delivery-workspace";
import { GitCommandFailedError, runGitOrThrow } from "../../../src/adapters/git/run-git";

const META = "instances/pdi/metadata";
const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "snagentic-delivery-"));
  cleanups.push(root);
  await git(root, "init", "-q", "-b", "main");
  const write = async (path: string, content: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await write(`${META}/global/a.yaml`, "a: 1\n");
  await write(`${META}/global/b.yaml`, "b: 1\n");
  await write("README.md", "hi\n");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "first");
  return { root, write, workspace: new GitDeliveryWorkspace(root, InstanceName.parse("pdi")) };
}

describe("GitDeliveryWorkspace and the branch's commits (ADR-0022)", () => {
  it("lists source files whose working copy differs from HEAD: edited, staged or new", async () => {
    const { root, write, workspace } = await repository();
    expect(await workspace.uncommittedSource()).toEqual([]);
    await write("source/x_app/a.now.ts", "a\n");
    await write("source/x_app/b.now.ts", "b\n");
    await git(root, "add", "source/x_app/b.now.ts");
    await write(`${META}/global/c.script.js`, "c();\n");
    await write("README.md", "changed\n");
    expect(await workspace.uncommittedSource()).toEqual([
      "source/x_app/a.now.ts",
      "source/x_app/b.now.ts",
    ]);
  });

  it("commits the files, and changes nothing when they are as committed (an install resumed)", async () => {
    const { root, write, workspace } = await repository();
    await write("source/global/src/fluent/ensure-m.now.ts", "x\n");
    const first = await workspace.commitFiles(["source/global/src/fluent/ensure-m.now.ts"], "add");
    expect((await git(root, "rev-parse", "HEAD")).trim()).toBe(first);
    await write("source/global/src/fluent/ensure-m.now.ts", "x\n");
    expect(await workspace.commitFiles(["source/global/src/fluent/ensure-m.now.ts"], "again")).toBe(
      first,
    );
  });

  it("fails a commit a commit-msg hook rejects with git's message and a hint, committing nothing", async () => {
    const { root, write, workspace } = await repository();
    // The repository's own hooks path, so a global core.hooksPath cannot bypass the hook.
    await write(
      ".hooks/commit-msg",
      "#!/bin/sh\necho 'commit message needs a ticket key' >&2\nexit 1\n",
    );
    await chmod(join(root, ".hooks/commit-msg"), 0o755);
    await git(root, "config", "core.hooksPath", ".hooks");
    const before = (await git(root, "rev-parse", "HEAD")).trim();
    await write("source/x_app/snagentic.ledger.yaml", "x: 1\n");
    const failed = workspace.commitFiles(["source/x_app/snagentic.ledger.yaml"], "ledger");
    await expect(failed).rejects.toBeInstanceOf(GitCommandFailedError);
    await expect(failed).rejects.toMatchObject({
      code: "git-command-failed",
      category: "precondition",
      message: expect.stringContaining("commit message needs a ticket key"),
      hint: expect.stringContaining("hook"),
    });
    expect((await git(root, "rev-parse", "HEAD")).trim()).toBe(before);
  });

  it("publishes the branch to origin and sets it as upstream", async () => {
    const { root, workspace } = await repository();
    const remote = await mkdtemp(join(tmpdir(), "snagentic-remote-"));
    cleanups.push(remote);
    await git(remote, "init", "-q", "--bare");
    await git(root, "remote", "add", "origin", remote);
    await git(root, "switch", "-qc", "feature/x");
    await workspace.publishBranch("feature/x");
    expect((await git(remote, "branch", "--list", "feature/x")).trim()).toBe("feature/x");
    expect((await git(root, "rev-parse", "--abbrev-ref", "feature/x@{upstream}")).trim()).toBe(
      "origin/feature/x",
    );
  });

  it("publishes to the branch's own remote when it has one", async () => {
    const { root, workspace } = await repository();
    const remote = await mkdtemp(join(tmpdir(), "snagentic-remote-"));
    cleanups.push(remote);
    await git(remote, "init", "-q", "--bare");
    await git(root, "remote", "add", "team", remote);
    await git(root, "switch", "-qc", "feature/y");
    await git(root, "config", "branch.feature/y.remote", "team");
    await workspace.publishBranch("feature/y");
    expect((await git(remote, "branch", "--list", "feature/y")).trim()).toBe("feature/y");
  });

  it("says why a branch could not be published", async () => {
    const { workspace } = await repository();
    await expect(workspace.publishBranch("main")).rejects.toMatchObject({
      code: "branch-not-published",
    });
  });
});
