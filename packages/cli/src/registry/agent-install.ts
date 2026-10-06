import { INSTRUCTIONS, skillFiles } from "@snagentic/agent-packs";
import { installAgentPack, VERSION } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const agentInstall = defineUseCase({
  name: "install",
  group: "agent",
  description:
    "Install the agent pack into the workspace: the workflow skills (.agents/skills), the " +
    "instructions block in AGENTS.md and its import in CLAUDE.md. Commit them so the whole " +
    "team's agents work the same way. Run again after upgrading snagentic.",
  input: z.object({}),
  output: z.object({
    root: z.string(),
    version: z.string(),
    files: z
      .array(z.object({ path: z.string(), status: z.enum(["created", "updated", "unchanged"]) }))
      .readonly(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(_input, context) {
    const root = await workspaceRoot(context);
    const files = await installAgentPack(context.workspaceFiles, root, {
      version: VERSION,
      instructions: INSTRUCTIONS,
      files: skillFiles(VERSION),
    });
    return { root, version: VERSION, files };
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
