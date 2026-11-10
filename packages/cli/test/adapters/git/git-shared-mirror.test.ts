import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitSharedMirror } from "../../../src/adapters/git/git-shared-mirror";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function repositories() {
  const base = await mkdtemp(join(tmpdir(), "snagentic-shared-"));
  temporary.push(base);
  const origin = join(base, "origin.git");
  const root = join(base, "w");
  await runGitOrThrow(["init", "-q", "--bare", origin], base);
  await runGitOrThrow(["init", "-q", root], base);
  await runGitOrThrow(["remote", "add", "origin", origin], root);
  await runGitOrThrow(["remote", "add", "gone", join(base, "missing.git")], root);
  return { root };
}

describe("gitSharedMirror", () => {
  it("finds no shared mirror on a remote without the branch", async () => {
    const { root } = await repositories();
    expect(await gitSharedMirror.fetch(root, "pdi", "origin")).toBeNull();
    expect(await gitSharedMirror.localTip(root, "pdi")).toBeNull();
  });

  it("names the remote when git cannot reach it", async () => {
    const { root } = await repositories();
    await expect(gitSharedMirror.fetch(root, "pdi", "gone")).rejects.toMatchObject({
      code: "shared-mirror-unreachable",
    });
    await expect(gitSharedMirror.publish(root, "pdi", "gone", "HEAD")).rejects.toMatchObject({
      code: "shared-mirror-unreachable",
    });
  });
});
