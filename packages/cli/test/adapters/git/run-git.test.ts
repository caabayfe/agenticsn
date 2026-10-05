import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitLines, runGitOrThrow } from "../../../src/adapters/git/run-git";

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const all: string[] = [];
  for await (const line of lines) {
    all.push(line);
  }
  return all;
}

describe("gitLines", () => {
  it("streams git's output one line at a time", async () => {
    const repo = await mkdtemp(join(tmpdir(), "snagentic-lines-"));
    try {
      await runGitOrThrow(["init", "-q", "-b", "main"], repo);
      await writeFile(join(repo, "a.txt"), "a");
      await writeFile(join(repo, "b c.txt"), "b");
      await runGitOrThrow(["add", "."], repo);
      expect(await collect(gitLines(["ls-files"], repo))).toEqual(["a.txt", "b c.txt"]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("fails with git's message", async () => {
    await expect(
      collect(gitLines(["rev-parse", "--verify", "no-such-ref"], tmpdir())),
    ).rejects.toThrow(/git rev-parse --verify no-such-ref failed/);
  });
});
