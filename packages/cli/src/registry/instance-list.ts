import { INSTANCE_KINDS, listInstances, usernameSourceLabel } from "@snagentic/core";
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
        usernameSource: z
          .string()
          .describe("where the username came from: environment, this clone or instance.yaml"),
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
        usernameSource: usernameSourceLabel(profile),
      })),
    };
  },
  render(output) {
    if (output.instances.length === 0) {
      return "no instances yet; add one with: snagentic instance add <name> --url <url> --username <user>";
    }
    const nameWidth = Math.max(...output.instances.map((instance) => instance.name.length));
    const user = (i: { username: string; usernameSource: string }) =>
      `${i.username} (${i.usernameSource})`;
    const userWidth = Math.max(...output.instances.map((instance) => user(instance).length));
    return output.instances
      .map(
        (i) =>
          `${i.name.padEnd(nameWidth)}  ${i.kind.padEnd(11)}  ${user(i).padEnd(userWidth)}  ${i.url}`,
      )
      .join("\n");
  },
  exitCode: () => 0,
});
