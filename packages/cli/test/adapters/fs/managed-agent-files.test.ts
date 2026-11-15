import { afterEach, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { managedAgentFiles } from "../../../src/adapters/fs/managed-agent-files";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("writes complete user skill files and refuses linked destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "snagentic-user-skills-"));
  roots.push(root);
  const files = managedAgentFiles(root);
  const path = join(root, ".agents/skills/servicenow-test/SKILL.md");
  await files.write(path, "first");
  await files.write(path, "second");
  expect(await readFile(path, "utf8")).toBe("second");
  await mkdir(join(root, ".claude"));
  await symlink(join(root, ".agents/skills"), join(root, ".claude/skills"), "dir");
  await expect(
    files.write(join(root, ".claude/skills/servicenow-test/SKILL.md"), "bad"),
  ).rejects.toMatchObject({ code: "invalid-input" });
  await expect(files.read(join(root, "../outside"))).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("second");
});
