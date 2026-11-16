import { isAbsolute, join, resolve } from "node:path";
import { AGENT_HOSTS, initWorkspace } from "@snagentic/core";
import { z } from "zod";
import { installAgentIntegration } from "./install-agent-integration";
import { defineUseCase, type HostEnvironment } from "./use-case";

export function resolvePath(path: string, host: HostEnvironment): string {
  if (path === "~" || path.startsWith("~/")) {
    return join(host.home, path.slice(1));
  }
  return isAbsolute(path) ? path : resolve(host.cwd, path);
}

export const init = defineUseCase({
  help: {
    summary: "Create a workspace manually",
    section: "Get started",
    visibility: "advanced",
    details:
      "Create a dedicated git workspace with a global Fluent project. For a complete " +
      "first-time setup, use snagentic onboard instead. Installs bundled user skills and workspace agent integration.",
    effects:
      "Creates a workspace, source files, user skills and workspace agent configuration; does not call the instance.",
    examples: [["init", "./workspace"]],
  },
  name: "init",
  description:
    "Create a snagentic workspace: a dedicated git repository with the standard layout for " +
    "synced instance data, and the Fluent project for global changes (source/global). Run " +
    "once per ServiceNow estate.",
  input: z.object({
    path: z.string().optional().describe("where to create it (default ~/snagentic/<name>)"),
    name: z.string().default("workspace").describe("folder name for the default location"),
  }),
  output: z.object({
    root: z.string(),
    layout: z.number(),
    nextSteps: z.array(z.string()),
    agentWarnings: z.array(z.string()).optional(),
  }),
  flags: {
    readOnly: false,
    destructive: false,
    requiresDevelopmentInstance: false,
    // It creates the workspace: there is none to lock yet, and it needs an empty folder.
    lock: "none",
  },
  mcp: false,
  arguments: ["path"],
  async handle(input, context) {
    const root = resolvePath(input.path ?? `~/snagentic/${input.name}`, context.host);
    // Global changes have a project from the start (ADR-0031); a scope gets one when its first
    // record is adopted.
    const scaffold = () =>
      context.authoring(root).workspace.scaffold({ name: "global", sysId: "global" });
    const manifest = await initWorkspace(root, context.host.version, context.workspaces, scaffold);
    const installed = await installAgentIntegration(context, root, AGENT_HOSTS);
    const agentWarnings = installed
      .filter((file) => file.status === "skipped")
      .map((file) => file.path);
    return { root, layout: manifest.layout, nextSteps: [`cd ${root}`], agentWarnings };
  },
  render(output) {
    return [
      `workspace created at ${output.root} (layout ${output.layout})`,
      ...(output.agentWarnings ?? []).map(
        (path) => `preserved agent file; review before use: ${path}`,
      ),
      "next:",
      ...output.nextSteps.map((step) => `  ${step}`),
    ].join("\n");
  },
  exitCode() {
    return 0;
  },
});
