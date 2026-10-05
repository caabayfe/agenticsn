import { credentialAccount, getInstance, InstanceName, logout } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const authLogout = defineUseCase({
  group: "auth",
  name: "logout",
  description: "Delete the stored password for an instance from the OS keychain.",
  input: z.object({ instance: z.string() }),
  output: z.object({ instance: z.string(), account: z.string(), removed: z.boolean() }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["instance"],
  async handle(input, context) {
    const profile = await getInstance(
      await workspaceRoot(context),
      InstanceName.parse(input.instance),
      context.profiles,
    );
    const removed = await logout(profile, context.credentials);
    return { instance: profile.name, account: credentialAccount(profile), removed };
  },
  render(output) {
    return output.removed
      ? `deleted stored credentials for ${output.account}`
      : `no stored credentials for ${output.account}`;
  },
  exitCode: () => 0,
});
