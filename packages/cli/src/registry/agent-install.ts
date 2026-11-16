import { AGENT_HOSTS, VERSION, WorkspaceNotFoundError } from "@snagentic/core";
import { z } from "zod";
import { installAgentIntegration } from "./install-agent-integration";
import { defineUseCase } from "./use-case";
import { HELP_GROUPS } from "./use-case-help";
import { workspaceRoot } from "./workspace-root";

export const agentInstall = defineUseCase({
  help: {
    summary: "Install agent instructions, skills and hooks",
    section: "Get started",
    group: HELP_GROUPS.agent,
    details:
      "Install bundled workflow skills at user level, plus instructions, hooks and MCP " +
      "bindings in the current workspace. Use --scope workspace for cloud runners. " +
      "Existing personal skills are preserved. Rerun after upgrading.",
    effects: "Writes user skills and workspace integration; does not call the instance.",
    examples: [
      ["agent", "install"],
      ["agent", "install", "--host", "claude"],
    ],
  },
  name: "install",
  group: "agent",
  description:
    "Install bundled user-level ServiceNow workflow skills and, in a workspace, AGENTS.md, " +
    "hooks and MCP bindings. Preserves edited or unowned personal skills. Outside a workspace " +
    "installs only user skills. Use workspace scope for ephemeral or cloud hosts.",
  input: z.object({
    host: z
      .enum(["all", ...AGENT_HOSTS])
      .default("all")
      .describe("the agent hosts to install for: all, claude, copilot or codex"),
    scope: z
      .enum(["user", "workspace"])
      .default("user")
      .describe("where skills are installed; instructions and MCP bindings stay in the workspace"),
  }),
  output: z.object({
    root: z.string().nullable(),
    version: z.string(),
    hosts: z.array(z.enum(AGENT_HOSTS)).readonly(),
    files: z
      .array(
        z.object({
          path: z.string(),
          status: z.enum(["created", "updated", "unchanged", "skipped", "removed"]),
        }),
      )
      .readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(input, context) {
    let root: string | null = null;
    try {
      root = await workspaceRoot(context);
    } catch (error) {
      if (!(error instanceof WorkspaceNotFoundError)) throw error;
    }
    if (input.scope === "workspace" && root === null)
      throw new WorkspaceNotFoundError(context.host.cwd);
    const hosts = input.host === "all" ? AGENT_HOSTS : [input.host];
    const files = await installAgentIntegration(context, root, hosts, input.scope);
    return { root, version: VERSION, hosts, files };
  },
  render(output) {
    const changed = output.files.filter((file) => file.status !== "unchanged");
    return [
      ...changed.map((file) => `${file.status.padEnd(8)} ${file.path}`),
      changed.length === 0
        ? `agent pack ${output.version} is already installed`
        : `agent pack ${output.version} installed; commit the workspace configuration${output.root === null ? " after running in a workspace" : ` in ${output.root}`}`,
      ...(output.files.some((file) => file.status === "skipped")
        ? [
            "Some files were preserved; review skipped paths before relying on the installed workflows.",
          ]
        : []),
    ].join("\n");
  },
  exitCode: () => 0,
});
