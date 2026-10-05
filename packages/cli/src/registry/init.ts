import { isAbsolute, join, resolve } from "node:path";
import { initWorkspace } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase, type HostEnvironment } from "./use-case";

function resolvePath(path: string, host: HostEnvironment): string {
  if (path === "~" || path.startsWith("~/")) {
    return join(host.home, path.slice(1));
  }
  return isAbsolute(path) ? path : resolve(host.cwd, path);
}

export const init = defineUseCase({
  name: "init",
  description:
    "Create a snagentic workspace: a dedicated git repository with the standard layout for " +
    "synced instance data. Run once per ServiceNow estate.",
  input: z.object({
    path: z.string().optional().describe("where to create it (default ~/snagentic/<name>)"),
    name: z.string().default("workspace").describe("folder name for the default location"),
  }),
  output: z.object({
    root: z.string(),
    layout: z.number(),
    nextSteps: z.array(z.string()),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["path"],
  async handle(input, context) {
    const root = resolvePath(input.path ?? `~/snagentic/${input.name}`, context.host);
    const manifest = await initWorkspace(root, context.host.version, context.workspaces);
    return { root, layout: manifest.layout, nextSteps: [`cd ${root}`] };
  },
  render(output) {
    return [
      `workspace created at ${output.root} (layout ${output.layout})`,
      "next:",
      ...output.nextSteps.map((step) => `  ${step}`),
    ].join("\n");
  },
  exitCode() {
    return 0;
  },
});
