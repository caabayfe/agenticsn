import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhPullRequests } from "../../../src/adapters/delivery/gh-pull-requests";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const signal = new AbortController().signal;

// A stand-in for the GitHub CLI: logs its arguments, then runs `body` (a shell snippet).
async function fakeGh(body: string) {
  const dir = await mkdtemp(join(tmpdir(), "snagentic-gh-"));
  cleanups.push(dir);
  const log = join(dir, "calls.log");
  const script = join(dir, "gh");
  await writeFile(script, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n${body}\n`);
  await chmod(script, 0o755);
  const calls = async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n");
  return { gh: new GhPullRequests(dir, script), calls };
}

describe("GhPullRequests (ADR-0022)", () => {
  it("finds the branch's open pull request", async () => {
    const { gh, calls } = await fakeGh(`echo '[{"url":"https://github.com/a/b/pull/3"}]'`);
    expect(await gh.find("feature/x", signal)).toEqual({
      kind: "found",
      url: "https://github.com/a/b/pull/3",
    });
    expect(await calls()).toEqual(["pr list --head feature/x --state open --json url --limit 1"]);
  });

  it("finds none when the branch has no open pull request", async () => {
    const { gh } = await fakeGh("echo '[]'");
    expect(await gh.find("feature/x", signal)).toEqual({ kind: "none" });
  });

  it("is unavailable, with the CLI's reason, when gh fails or is missing", async () => {
    const { gh } = await fakeGh(
      "echo 'To get started with GitHub CLI, please run:  gh auth login' >&2\nexit 4",
    );
    expect(await gh.find("feature/x", signal)).toEqual({
      kind: "unavailable",
      reason: "To get started with GitHub CLI, please run:  gh auth login",
    });
    const missing = new GhPullRequests(tmpdir(), "/nonexistent/gh");
    expect(await missing.find("feature/x", signal)).toEqual({
      kind: "unavailable",
      reason: "the GitHub CLI (gh) is not installed",
    });
    const { gh: garbled } = await fakeGh("echo 'not json'");
    expect(await garbled.find("feature/x", signal)).toMatchObject({ kind: "unavailable" });
  });

  it("is unavailable when gh does not answer in time", async () => {
    const { gh } = await fakeGh("sleep 5");
    const slow = new GhPullRequests(gh.root, gh.executable, 200);
    expect(await slow.find("feature/x", signal)).toMatchObject({ kind: "unavailable" });
  });

  it("reads the repository's default branch, or none when it cannot", async () => {
    const { gh, calls } = await fakeGh("echo main");
    expect(await gh.defaultBranch(signal)).toBe("main");
    expect(await calls()).toEqual([
      "repo view --json defaultBranchRef --jq .defaultBranchRef.name",
    ]);
    const { gh: failing } = await fakeGh("exit 1");
    expect(await failing.defaultBranch(signal)).toBeNull();
  });

  it("opens a draft pull request and returns its URL", async () => {
    const { gh, calls } = await fakeGh(
      "echo 'Creating draft pull request...'\necho https://github.com/a/b/pull/8",
    );
    const url = await gh.openDraft({ branch: "feature/x", title: "feature/x", body: "B" }, signal);
    expect(url).toBe("https://github.com/a/b/pull/8");
    expect(await calls()).toEqual([
      "pr create --draft --head feature/x --title feature/x --body B",
    ]);
  });

  it("says why a draft pull request could not be opened", async () => {
    const { gh } = await fakeGh(
      "echo 'GraphQL: No commits between main and feature/x' >&2\nexit 1",
    );
    await expect(
      gh.openDraft({ branch: "feature/x", title: "t", body: "b" }, signal),
    ).rejects.toMatchObject({
      code: "pull-request-unavailable",
      message: expect.stringContaining("No commits between main and feature/x"),
    });
  });
});
