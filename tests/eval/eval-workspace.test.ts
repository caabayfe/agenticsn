import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGitOrThrow } from "../../packages/cli/src/adapters/git/run-git";
import { removeTestTree } from "../../packages/cli/test/support/remove-test-tree";
import type { Fixture } from "../../scripts/eval/types";
import { prepareScenario } from "../../scripts/eval/workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const MIRROR = "instances/pdi/metadata/global/sys_script/rule--1.yaml";
const WORK = "source/x_app/src/server/work.js";

const writes =
  (path: string): Fixture =>
  async (workspace, { instance }) => {
    await mkdir(join(workspace, path, ".."), { recursive: true });
    await writeFile(join(workspace, path), `for ${instance}\n`);
  };

// A slot as ensureSlot and prepareVariant leave it: one instance, its mirror branch tagged.
async function slot() {
  const root = await mkdtemp(join(tmpdir(), "snagentic-eval-slot-"));
  cleanups.push(() => removeTestTree(root, [root]));
  const git = async (...args: string[]) =>
    (await runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root)).trim();
  await git("init", "-q", "-b", "main");
  await writes("instances/pdi/instance.yaml")(root, { instance: "pdi" });
  await git("add", ".");
  await git("commit", "-qm", "variant");
  await git("branch", "servicenow-remote/pdi");
  await git("tag", "eval-mirror/pdi");
  return { root, git, variant: await git("rev-parse", "HEAD") };
}

describe("a scenario's starting state", () => {
  it("commits the fixture as the base and as the mirror's state, and leaves the user's work uncommitted", async () => {
    const { root, git, variant } = await slot();
    const base = await prepareScenario(root, variant, {
      fixture: writes(MIRROR),
      prepare: writes(WORK),
    });
    expect(base).not.toBe(variant);
    expect(await git("rev-parse", "HEAD")).toBe(base);
    expect(await git("show", `${base}:${MIRROR}`)).toBe("for pdi");
    // validate reads mirror edits against this branch: the fixture's records are not edits.
    expect(await git("rev-parse", "servicenow-remote/pdi")).toBe(base);
    expect(await git("status", "--short", "-uall")).toBe(`?? ${WORK}`);
  });

  it("starts the next scenario from the variant again, mirror branch included", async () => {
    const { root, git, variant } = await slot();
    await prepareScenario(root, variant, { fixture: writes(MIRROR), prepare: writes(WORK) });
    expect(await prepareScenario(root, variant, {})).toBe(variant);
    expect(await git("rev-parse", "HEAD")).toBe(variant);
    expect(await git("rev-parse", "servicenow-remote/pdi")).toBe(variant);
    expect(await git("status", "--short", "-uall")).toBe("");
  });
});
