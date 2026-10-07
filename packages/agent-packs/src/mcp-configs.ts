// Where each host reads a project's MCP servers, and snagentic's entry there (ADR-0002, tier 2).
// Written by agent install and committed, so a teammate's agent has the tools on clone.

export const MCP_CONFIGS = [
  // Claude Code starts project servers in the project's folder, where the workspace is found.
  // Copilot CLI reads it too.
  {
    path: ".mcp.json",
    key: "mcpServers",
    server: { command: "snagentic", args: ["mcp"] },
    hosts: ["claude", "copilot"],
  },
  // VS Code (GitHub Copilot) does not promise a working folder, so it names the workspace.
  {
    path: ".vscode/mcp.json",
    key: "servers",
    server: {
      type: "stdio",
      command: "snagentic",
      args: ["mcp"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code's variable, expanded by VS Code.
      env: { SNAGENTIC_WORKSPACE: "${workspaceFolder}" },
    },
    hosts: ["copilot"],
  },
] as const;
