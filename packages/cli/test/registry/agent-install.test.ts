import { afterEach, describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VERSION } from "@snagentic/core";
import { fsWorkspaceFiles } from "../../src/adapters/fs/fs-workspace-files";
import { agentInstall } from "../../src/registry/agent-install";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("agent install", () => {
  it("writes the pack into the workspace, keeping the team's own instructions", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await writeFile(join(ws.root, "AGENTS.md"), "# Our conventions\n");
    const { output } = await executeUseCase(agentInstall, {}, ws.context);
    expect(output).toMatchObject({ root: ws.root, version: VERSION });
    const agents = await readFile(join(ws.root, "AGENTS.md"), "utf8");
    expect(agents).toStartWith("# Our conventions\n\n<!-- snagentic:begin ");
    expect(await readFile(join(ws.root, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    const skill = await readFile(
      join(ws.root, ".agents/skills/servicenow-explain/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: servicenow-explain");
    expect(
      await readFile(join(ws.root, ".claude/skills/servicenow-explain/SKILL.md"), "utf8"),
    ).toBe(skill);
    expect(agentInstall.render(output as never, "text")).toContain("commit these files");
  });

  it("says when the pack is already installed", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await executeUseCase(agentInstall, {}, ws.context);
    const { output } = await executeUseCase(agentInstall, {}, ws.context);
    expect(agentInstall.render(output as never, "text")).toBe(
      `agent pack ${VERSION} is already installed`,
    );
  });
});

describe("fsWorkspaceFiles", () => {
  it("reads a missing file as none, and reports other failures", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    expect(await fsWorkspaceFiles.read(join(ws.root, "nope.md"))).toBeNull();
    await expect(fsWorkspaceFiles.read(ws.root)).rejects.toThrow();
  });
});
