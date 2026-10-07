import { isAbsolute, relative, resolve } from "node:path";
import { InvalidInputError, protectedReason } from "@snagentic/core";
import { z } from "zod";
import { executeUseCase } from "./execute";
import { updateSetsCollisions } from "./update-sets-collisions";
import { updateSetsExport } from "./update-sets-export";
import { updateSetsList } from "./update-sets-list";
import { updateSetsShow } from "./update-sets-show";
import { defineUseCase, type UseCaseContext } from "./use-case";
import { workspaceRoot } from "./workspace-root";

// An agent names the export file, so it may only be a new, unprotected file in the workspace;
// the person's CLI may write anywhere.
async function workspaceOutput(context: UseCaseContext, output: string): Promise<string> {
  const root = await workspaceRoot(context);
  const path = resolve(root, output);
  const inside = relative(root, path);
  if (isAbsolute(output) || inside.startsWith("..") || isAbsolute(inside)) {
    throw new InvalidInputError(`export output must be a path inside the workspace: ${output}`);
  }
  const reason = protectedReason(inside);
  if (reason !== null) {
    throw new InvalidInputError(`export output may not be ${inside}: ${reason}`);
  }
  return path;
}

// The plan's single update-sets MCP tool: the four update-sets commands behind one `action`,
// so they take one place in the tool budget (ADR-0002). Each action runs its command.
export const updateSetsTool = defineUseCase({
  name: "update-sets-tool",
  description:
    "Read a ServiceNow instance's update sets. action=list: open and recently changed sets with " +
    "update counts. show: one set's updates (needs id). collisions: records held by more than " +
    "one open set. export: write a set as ServiceNow XML (needs id). Never changes the instance.",
  input: z.object({
    instance: z.string(),
    action: z.enum(["list", "show", "collisions", "export"]),
    id: z.string().optional().describe("the update set's sys_id, for show and export"),
    days: z.number().int().min(0).default(30).describe("list: also sets changed in this many days"),
    output: z
      .string()
      .optional()
      .describe("export: new file to write, relative to the workspace root"),
  }),
  output: z.object({
    action: z.enum(["list", "show", "collisions", "export"]),
    list: updateSetsList.output.optional(),
    show: updateSetsShow.output.optional(),
    collisions: updateSetsCollisions.output.optional(),
    export: updateSetsExport.output.optional(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  mcpName: "update_sets",
  cli: false,
  async handle(input, context, run) {
    const { action, instance, id, days, output } = input;
    const selected = {
      list: updateSetsList,
      show: updateSetsShow,
      collisions: updateSetsCollisions,
      export: updateSetsExport,
    }[action];
    const args = {
      instance,
      days,
      ...(id === undefined ? {} : { id }),
      ...(output === undefined ? {} : { output: await workspaceOutput(context, output) }),
    };
    const result = await executeUseCase(selected, args, context, run);
    return { action, [action]: result.output };
  },
  render: (output) => JSON.stringify(output),
  exitCode: () => 0,
});
