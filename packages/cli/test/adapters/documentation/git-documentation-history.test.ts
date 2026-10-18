import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsDocumentationSources } from "../../../src/adapters/documentation/fs-documentation-sources";
import { GitDocumentationHistory } from "../../../src/adapters/documentation/git-documentation-history";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const PAGE = "processes/incident/use/report.md";
const page = (hash: string) =>
  `---\ntitle: Report\nevidence:\n  E01:\n    record: sys_script/a1\n    how: read\n    result: ok\n    hash: ${hash}\n---\nText. [E01]\n`;

// A repository whose workspace is a folder inside it, as a monorepo would hold one.
function repository() {
  const repo = mkdtempSync(join(tmpdir(), "snagentic-history-"));
  roots.push(repo);
  const workspace = join(repo, "ws");
  const write = (path: string, text: string) => {
    mkdirSync(join(workspace, "documentation", path, ".."), { recursive: true });
    writeFileSync(join(workspace, "documentation", path), text);
  };
  const git = (...args: string[]) =>
    runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], repo);
  return { workspace, write, git };
}

describe("documentation in git history", () => {
  it("lists what changed since a commit and reads pages as that commit held them", async () => {
    const { workspace, write, git } = repository();
    write(PAGE, page("h1"));
    write("site.yaml", "title: Docs\ninstance: pdi\n");
    await git("init", "-q");
    await git("add", ".");
    await git("commit", "-qm", "first");
    const base = (await git("rev-parse", "HEAD")).trim();
    write(PAGE, page("h2"));
    write("changes/2026-10.md", "---\ntitle: October\ndate: 2026-10-18\nnotes: []\n---\n");
    const history = new GitDocumentationHistory(workspace);
    expect(await history.changedSince(base)).toEqual([PAGE]);
    const [before] = await history.at(base, [PAGE, "changes/2026-10.md"]);
    expect(before?.path).toBe(PAGE);
    expect(JSON.stringify(before?.frontMatter)).toContain('"hash":"h1"');
    expect(await history.changedSince("no-such-commit")).toEqual([]);
    const releases = await new FsDocumentationSources(workspace).releases();
    expect(releases.map((release) => release.path)).toEqual(["changes/2026-10.md"]);
  });
});
