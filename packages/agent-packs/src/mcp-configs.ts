// Workspace bindings, backed by the same executable and credential policies (ADR-0057).
export const CODEX_SERVERS = Object.fromEntries(
  ["investigate", "develop"].map((profile) => [
    `snagentic-${profile}`,
    { command: "snagentic", args: ["mcp", "--profile", profile] },
  ]),
);

export const MCP_CONFIGS = ["investigate", "develop"].flatMap((profile) => [
  {
    name: `snagentic-${profile}`,
    path: ".mcp.json",
    key: "mcpServers",
    hosts: ["claude", "copilot"] as const,
    server: { command: "snagentic", args: ["mcp", "--profile", profile] },
    legacy: { command: "snagentic", args: ["mcp"] },
  },
  {
    name: `snagentic-${profile}`,
    path: ".vscode/mcp.json",
    key: "servers",
    hosts: ["copilot"] as const,
    server: {
      type: "stdio",
      command: "snagentic",
      args: ["mcp", "--profile", profile],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code expands its workspace variable.
      env: { SNAGENTIC_WORKSPACE: "${workspaceFolder}" },
    },
    legacy: {
      type: "stdio",
      command: "snagentic",
      args: ["mcp"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code expands its workspace variable.
      env: { SNAGENTIC_WORKSPACE: "${workspaceFolder}" },
    },
  },
]);
