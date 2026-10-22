import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { childEnvironment } from "../../src/adapters/child-environment";
import { runGitOrThrow } from "../../src/adapters/git/run-git";

describe("childEnvironment (spec 012, step 3)", () => {
  const parent = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    GH_TOKEN: "gh-own-token",
    SNAGENTIC_ACME_PROD_PASSWORD: "instance-secret",
    SNAGENTIC_ACME_PROD_URL: "https://acme.service-now.com",
    SNAGENTIC_WORKSPACE: "/work",
  };

  it("drops every instance credential", () => {
    expect(childEnvironment({}, parent)).not.toHaveProperty("SNAGENTIC_ACME_PROD_PASSWORD");
  });

  it("keeps what the tools need, including their own credentials", () => {
    expect(childEnvironment({}, parent)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
      GH_TOKEN: "gh-own-token",
      SNAGENTIC_ACME_PROD_URL: "https://acme.service-now.com",
      SNAGENTIC_WORKSPACE: "/work",
    });
  });

  it("adds the caller's variables over the parent's", () => {
    expect(childEnvironment({ HOME: "/tmp", GIT_TERMINAL_PROMPT: "0" }, parent)).toMatchObject({
      HOME: "/tmp",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("never lets a caller add a credential back", () => {
    const env = childEnvironment({ SNAGENTIC_X_PASSWORD: "again" }, parent);
    expect(env).not.toHaveProperty("SNAGENTIC_X_PASSWORD");
  });

  it("does not pass instance credentials to git", async () => {
    const repo = await mkdtemp(join(tmpdir(), "snagentic-child-env-"));
    const variable = "SNAGENTIC_CHILD_ENV_TEST_PASSWORD";
    process.env[variable] = "must-not-leak";
    try {
      // A git alias starting with ! runs in a shell with git's environment.
      const seen = await runGitOrThrow(["-c", "alias.showenv=!env", "showenv"], repo);
      expect(seen).toContain("GIT_TERMINAL_PROMPT=0");
      expect(seen).not.toContain(variable);
    } finally {
      delete process.env[variable];
      await rm(repo, { recursive: true, force: true });
    }
  });
});
