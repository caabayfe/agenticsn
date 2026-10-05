import { getInstance, InstanceName } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const integrate = defineUseCase({
  name: "integrate",
  description:
    "Merge the latest pull of an instance into the workspace's current branch. Local work is never " +
    "overwritten: conflicting changes get git conflict markers.",
  input: z.object({ instance: z.string() }),
  output: z.object({
    instance: z.string(),
    commit: z.string().nullable(),
    changedFiles: z.number(),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const name = InstanceName.parse(input.instance);
    await getInstance(root, name, context.profiles);
    const result = await context.integrator.integrate(root, name);
    return { instance: name, ...result };
  },
  render(output) {
    return output.commit === null
      ? `${output.instance}: already up to date`
      : `${output.instance}: integrated ${output.changedFiles} changed file(s) -> ${output.commit.slice(0, 10)}`;
  },
  exitCode: () => 0,
});
