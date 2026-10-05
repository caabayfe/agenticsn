import { credentialAccount, getInstance, InstanceName, login } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const authLogin = defineUseCase({
  group: "auth",
  name: "login",
  description:
    "Store the password for an instance in the OS keychain. Prompts without echo, or reads stdin.",
  input: z.object({ instance: z.string() }),
  output: z.object({ instance: z.string(), account: z.string(), stored: z.literal("keychain") }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  // Secrets never pass through an agent.
  mcp: false,
  arguments: ["instance"],
  async handle(input, context) {
    const profile = await getInstance(
      await workspaceRoot(context),
      InstanceName.parse(input.instance),
      context.profiles,
    );
    const account = credentialAccount(profile);
    await login(
      profile,
      await context.secrets.read(`password for ${account}: `),
      context.credentials,
    );
    return { instance: profile.name, account, stored: "keychain" as const };
  },
  render(output) {
    return `stored credentials for ${output.account} in the OS keychain`;
  },
  exitCode: () => 0,
});
