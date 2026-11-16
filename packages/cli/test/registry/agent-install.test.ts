import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  it("shares user skills and installs workspace integration, keeping team instructions", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await writeFile(join(ws.root, "AGENTS.md"), "# Our conventions\n");
    const { output } = await executeUseCase(agentInstall, {}, ws.context);
    expect(output).toMatchObject({ root: ws.root, version: VERSION });
    const agents = await readFile(join(ws.root, "AGENTS.md"), "utf8");
    expect(agents).toStartWith("# Our conventions\n\n<!-- snagentic:begin ");
    expect(await readFile(join(ws.root, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    const skill = await readFile(
      join(ws.context.host.home, ".agents/skills/servicenow-explain/SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("name: servicenow-explain");
    expect(
      await readFile(
        join(ws.context.host.home, ".claude/skills/servicenow-explain/SKILL.md"),
        "utf8",
      ),
    ).toBe(skill);
    const settings = JSON.parse(await readFile(join(ws.root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe("snagentic hook claude post-edit");
    expect(settings.permissions.ask).toContain("mcp__snagentic__push");
    // Registered under the name the permission rules use (mcp__snagentic__*).
    const claudeMcp = JSON.parse(await readFile(join(ws.root, ".mcp.json"), "utf8"));
    expect(claudeMcp.mcpServers["snagentic-investigate"]).toEqual({
      command: "snagentic",
      args: ["mcp", "--profile", "investigate"],
    });
    expect(claudeMcp.mcpServers["snagentic-develop"].args).toEqual(["mcp", "--profile", "develop"]);
    const vscodeMcp = JSON.parse(await readFile(join(ws.root, ".vscode/mcp.json"), "utf8"));
    expect(vscodeMcp.servers["snagentic-investigate"].env).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code's variable, kept literal.
      SNAGENTIC_WORKSPACE: "${workspaceFolder}",
    });
    const copilotHooks = JSON.parse(
      await readFile(join(ws.root, ".github/hooks/snagentic.json"), "utf8"),
    );
    expect(copilotHooks.version).toBe(1);
    const hook = join(ws.root, ".git/hooks/pre-commit");
    const script = await readFile(hook, "utf8");
    expect(script).toContain("snagentic validate");
    // git runs a hook that is executable; Git for Windows, which has no mode bits, runs it with
    // the interpreter its first line names.
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    if (process.platform !== "win32") expect((await stat(hook)).mode & 0o111).not.toBe(0);
    expect(agentInstall.render(output as never, "text")).toContain(
      "commit the workspace configuration",
    );
  });

  it("installs only what GitHub Copilot reads, with no Claude Code files", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const { output } = await executeUseCase(agentInstall, { host: "copilot" }, ws.context);
    const paths = (output as { files: { path: string }[] }).files.map((file) => file.path);
    expect(paths).toContain(".github/hooks/snagentic.json");
    expect(paths).toContain(`${ws.context.host.home}/.agents/skills/servicenow-explain/SKILL.md`);
    expect(paths.filter((path) => path.includes("claude") || path === "CLAUDE.md")).toEqual([]);
  });

  it("supports workspace skills for cloud runners without creating user copies", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await executeUseCase(agentInstall, { scope: "workspace", host: "copilot" }, ws.context);
    expect(
      await readFile(join(ws.root, ".agents/skills/servicenow-explain/SKILL.md"), "utf8"),
    ).toContain("name: servicenow-explain");
    expect(
      await fsWorkspaceFiles.read(
        join(ws.context.host.home, ".agents/skills/servicenow-explain/SKILL.md"),
      ),
    ).toBeNull();
  });

  it("installs personal skills outside a workspace without writing global instructions or MCP bindings", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const context = { ...ws.context, host: { ...ws.context.host, cwd: ws.context.host.home } };
    const { output } = await executeUseCase(agentInstall, { host: "copilot" }, context);
    expect(output).toMatchObject({ root: null });
    expect(await fsWorkspaceFiles.read(join(context.host.home, "AGENTS.md"))).toBeNull();
    expect(await fsWorkspaceFiles.read(join(context.host.home, ".mcp.json"))).toBeNull();
    expect(
      await fsWorkspaceFiles.read(
        join(context.host.home, ".agents/skills/servicenow-explain/SKILL.md"),
      ),
    ).not.toBeNull();
  });

  it("migrates exact generated project skills and the old generated server while preserving edits", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    const folder = join(ws.root, ".agents/skills/servicenow-explain");
    const custom = join(ws.root, ".claude/skills/servicenow-explain");
    await mkdir(folder, { recursive: true });
    await mkdir(custom, { recursive: true });
    const old = await Bun.file(`${import.meta.dir}/../fixtures-legacy-explain.md`).text();
    await writeFile(join(folder, "SKILL.md"), old);
    await writeFile(join(custom, "SKILL.md"), `${old}Personal edits\n`);
    await writeFile(
      join(ws.root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          snagentic: { command: "snagentic", args: ["mcp"] },
          other: { command: "other" },
        },
      }),
    );
    const { output } = await executeUseCase(agentInstall, {}, ws.context);
    expect(output).toMatchObject({
      files: expect.arrayContaining([
        { path: ".agents/skills/servicenow-explain/SKILL.md", status: "removed" },
        { path: ".claude/skills/servicenow-explain/SKILL.md", status: "skipped" },
      ]),
    });
    expect(await fsWorkspaceFiles.read(join(folder, "SKILL.md"))).toBeNull();
    expect(await readFile(join(custom, "SKILL.md"), "utf8")).toEndWith("Personal edits\n");
    const config = JSON.parse(await readFile(join(ws.root, ".mcp.json"), "utf8"));
    expect(Object.keys(config.mcpServers).sort()).toEqual([
      "other",
      "snagentic-develop",
      "snagentic-investigate",
    ]);
  });

  it("installs explicit Codex project MCP bindings and shared personal skills", async () => {
    const ws = await instanceWorkspace({});
    cleanups.push(ws.cleanup);
    await executeUseCase(agentInstall, { host: "codex" }, ws.context);
    const config = Bun.TOML.parse(await readFile(join(ws.root, ".codex/config.toml"), "utf8"));
    expect(config).toMatchObject({
      mcp_servers: {
        "snagentic-investigate": {
          command: "snagentic",
          args: ["mcp", "--profile", "investigate"],
        },
        "snagentic-develop": { args: ["mcp", "--profile", "develop"] },
      },
    });
    expect(await fsWorkspaceFiles.read(join(ws.root, ".mcp.json"))).toBeNull();
    expect(
      await fsWorkspaceFiles.read(
        join(ws.context.host.home, ".agents/skills/servicenow-test/SKILL.md"),
      ),
    ).not.toBeNull();
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
