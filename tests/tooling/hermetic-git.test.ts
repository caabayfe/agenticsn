import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The test preload (tests/setup/hermetic-git.ts) keeps the developer's and the runner's git
// configuration out of every test (spec 014, R1): a global safe.bareRepository=explicit, a
// signing key or a default branch name must not change what the tests see.
describe("the tests' git configuration", () => {
  it("reads no global, system or injected git configuration", async () => {
    const dir = await mkdtemp(join(tmpdir(), "snagentic-hermetic-git-"));
    try {
      const listed = Bun.spawnSync(["git", "config", "--list", "--show-origin"], {
        cwd: dir,
        env: process.env,
      });
      expect(listed.stdout.toString().trim()).toBe("");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves no variable that injects git configuration", () => {
    const injected = Object.keys(process.env).filter((name) =>
      /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(name),
    );
    expect(injected).toEqual([]);
    expect(process.env["GIT_CONFIG_NOSYSTEM"]).toBe("1");
  });
});
