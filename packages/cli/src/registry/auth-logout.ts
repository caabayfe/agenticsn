import { credentialAccount, getInstance, InstanceName, logout } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const authLogout = defineUseCase({
  group: "auth",
  name: "logout",
  description:
    "Delete the stored password for an instance from the OS keychain, and this clone's " +
    "identity for it: the username then comes from instance.yaml again (ADR-0054).",
  input: z.object({ instance: z.string() }),
  output: z.object({
    instance: z.string(),
    account: z.string(),
    removed: z.boolean(),
    identityRemoved: z.boolean(),
  }),
  flags: {
    readOnly: false,
    destructive: true,
    requiresDevelopmentInstance: false,
    // Changes only the keychain, so it may run while a push holds the instance.
    locksWorkspace: false,
  },
  mcp: false,
  arguments: ["instance"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const profile = await getInstance(root, InstanceName.parse(input.instance), context.profiles);
    const removed = await logout(profile, context.credentials);
    const identityRemoved = await context.identities.remove(root, profile);
    return {
      instance: profile.name,
      account: credentialAccount(profile),
      removed,
      identityRemoved,
    };
  },
  render(output) {
    const secret = output.removed
      ? `deleted stored credentials for ${output.account}`
      : `no stored credentials for ${output.account}`;
    return output.identityRemoved
      ? `${secret}\nthis clone's identity for ${output.instance} removed; the username comes from instance.yaml`
      : secret;
  },
  exitCode: () => 0,
});
