import {
  credentialAccount,
  getInstance,
  INSTANCE_KINDS,
  InstanceName,
  login,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const authLogin = defineUseCase({
  group: "auth",
  name: "login",
  description:
    "Check the password with the instance, then store it in the OS keychain together with the " +
    "profile's url and kind; the password is used only while they match. Prompts without echo, " +
    "or reads stdin.",
  input: z.object({ instance: z.string() }),
  output: z.object({
    instance: z.string(),
    account: z.string(),
    url: z.string(),
    kind: z.enum(INSTANCE_KINDS),
    stored: z.literal("keychain"),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  // Secrets never pass through an agent.
  mcp: false,
  arguments: ["instance"],
  async handle(input, context, run) {
    const profile = await getInstance(
      await workspaceRoot(context),
      InstanceName.parse(input.instance),
      context.profiles,
    );
    const account = credentialAccount(profile);
    const secret = await context.secrets.read(`password for ${account}: `);
    const reader = context.connections.open(profile, secret);
    await login(profile, secret, context.credentials, reader, run.signal);
    const { url, kind } = profile;
    return { instance: profile.name, account, url, kind, stored: "keychain" as const };
  },
  render(output) {
    return `stored credentials for ${output.account} in the OS keychain, for ${output.url} as a ${output.kind} instance`;
  },
  exitCode: () => 0,
});
