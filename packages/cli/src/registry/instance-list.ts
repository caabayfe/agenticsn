import { INSTANCE_KINDS, listInstances } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const instanceList = defineUseCase({
  group: "instance",
  name: "list",
  description: "List the instance profiles in this workspace.",
  input: z.object({}),
  output: z.object({
    instances: z.array(
      z.object({
        name: z.string(),
        url: z.string(),
        kind: z.enum(INSTANCE_KINDS),
        username: z.string(),
      }),
    ),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  async handle(_input, context) {
    const profiles = await listInstances(await workspaceRoot(context), context.profiles);
    return {
      instances: profiles.map((profile) => ({
        name: profile.name,
        url: profile.url,
        kind: profile.kind,
        username: profile.auth.username,
      })),
    };
  },
  render(output) {
    if (output.instances.length === 0) {
      return "no instances yet; add one with: snagentic instance add <name> --url <url> --username <user>";
    }
    const nameWidth = Math.max(...output.instances.map((instance) => instance.name.length));
    const userWidth = Math.max(...output.instances.map((instance) => instance.username.length));
    return output.instances
      .map(
        (i) =>
          `${i.name.padEnd(nameWidth)}  ${i.kind.padEnd(11)}  ${i.username.padEnd(userWidth)}  ${i.url}`,
      )
      .join("\n");
  },
  exitCode: () => 0,
});
