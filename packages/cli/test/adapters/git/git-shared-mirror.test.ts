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

  it("moves the mirror branch only from the tip it was told, as F6's pulls do", async () => {
    const { root } = await repositories();
    const commit = async (message: string) =>
      (
        await runGitOrThrow(
          [
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit-tree",
            "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
            "-m",
            message,
          ],
          root,
        )
      ).trim();
    const first = await commit("first");
    const second = await commit("second");
    await gitSharedMirror.moveTo(root, "pdi", { commit: first, expected: null });
    expect(await gitSharedMirror.localTip(root, "pdi")).toBe(first);
    await expect(
      gitSharedMirror.moveTo(root, "pdi", { commit: second, expected: null }),
    ).rejects.toMatchObject({ code: "mirror-moved" });
    await gitSharedMirror.moveTo(root, "pdi", { commit: second, expected: first });
    expect(await gitSharedMirror.localTip(root, "pdi")).toBe(second);
  });
});
