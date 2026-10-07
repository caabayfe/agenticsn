import {
  CLAUDE_SETTINGS,
  copilotHookFile,
  INSTRUCTIONS,
  MCP_CONFIGS,
  skillFiles,
} from "@snagentic/agent-packs";
import { AGENT_HOSTS, installAgentPack, VERSION } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const agentInstall = defineUseCase({
  name: "install",
  group: "agent",
  description:
    "Install the agent pack into the workspace: the instructions block in AGENTS.md, a git " +
    "pre-commit hook that runs validate, and for each host its skills, hooks and MCP server. " +
    "GitHub Copilot (CLI, VS Code, cloud agent): .agents/skills, .github/hooks/snagentic.json, " +
    ".mcp.json and .vscode/mcp.json. Claude Code: .claude/skills, CLAUDE.md, " +
    ".claude/settings.json (hooks and permission rules) and .mcp.json. Commit them so the " +
    "whole team's agents work the same way. Run again after upgrading snagentic.",
  input: z.object({
    host: z
      .enum(["all", ...AGENT_HOSTS])
      .default("all")
      .describe("the agent hosts to install for: all, claude or copilot"),
  }),
  output: z.object({
    root: z.string(),
    version: z.string(),
    hosts: z.array(z.enum(AGENT_HOSTS)).readonly(),
    files: z
      .array(
        z.object({
          path: z.string(),
          status: z.enum(["created", "updated", "unchanged", "skipped"]),
        }),
      )
      .readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const hosts = input.host === "all" ? AGENT_HOSTS : [input.host];
    const pack = {
      version: VERSION,
      instructions: INSTRUCTIONS,
      files: [...skillFiles(VERSION), copilotHookFile()],
      claudeSettings: CLAUDE_SETTINGS,
      mcpConfigs: MCP_CONFIGS,
    };
    const files = await installAgentPack(context.workspaceFiles, root, pack, hosts);
    return { root, version: VERSION, hosts, files };
  },
  render(output) {
    const changed = output.files.filter((file) => file.status !== "unchanged");
    return [
      ...changed.map((file) => `${file.status.padEnd(8)} ${file.path}`),
      changed.length === 0
        ? `agent pack ${output.version} is already installed`
        : `agent pack ${output.version} installed in ${output.root}; commit these files`,
    ].join("\n");
  },
  exitCode: () => 0,
});
