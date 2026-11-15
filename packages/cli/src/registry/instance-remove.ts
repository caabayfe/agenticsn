import { getInstance, InstanceName, logout, removeInstance } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { HELP_GROUPS } from "./use-case-help";
import { workspaceRoot } from "./workspace-root";

export const instanceRemove = defineUseCase({
  help: {
    summary: "Remove an instance profile",
    section: "Manage",
    group: HELP_GROUPS.instance,
    details:
      "Remove a profile without deleting its mirrored data. Use --forget-credentials to also " +
      "remove its stored credentials.",
    effects:
      "Removes the workspace profile and, optionally, stored credentials; does not change the instance.",
    examples: [["instance", "remove", "dev"]],
  },
  group: "instance",
  name: "remove",
  description: "Remove an instance profile from this workspace. Synced data is not deleted.",
  input: z.object({
    name: z.string(),
    forgetCredentials: z.boolean().default(false).describe("also delete its stored credentials"),
  }),
  output: z.object({ removed: z.string(), credentialsRemoved: z.boolean() }),
  flags: {
    readOnly: false,
    destructive: true,
    requiresDevelopmentInstance: false,
    // The instance's own lock: its profile and credentials change under a pull or push otherwise.
    lock: { instance: "name" },
  },
  mcp: false,
  arguments: ["name"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const name = InstanceName.parse(input.name);
    const profile = await getInstance(root, name, context.profiles);
    const credentialsRemoved =
      input.forgetCredentials && (await logout(profile, context.credentials));
    await removeInstance(root, name, context.profiles);
    return { removed: name, credentialsRemoved };
  },
  render(output) {
    const credentials = output.credentialsRemoved
      ? "stored credentials deleted"
      : "stored credentials kept (other workspaces may use them)";
    return `removed profile ${output.removed}; ${credentials}`;
  },
  exitCode: () => 0,
});
