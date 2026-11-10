import {
  credentialAccount,
  getInstance,
  INSTANCE_KINDS,
  InstanceName,
  login,
  profileForLogin,
  rememberIdentity,
  secretName,
  usernameSourceLabel,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const authLogin = defineUseCase({
  group: "auth",
  name: "login",
  description:
    "Check the password (or OAuth client secret) with the instance, then store it in the OS " +
    "keychain together with the profile's url and kind; it is used only while they match. " +
    "With --username, sign in as that user and keep it as this clone's identity, whatever " +
    "instance.yaml names (ADR-0054). Prompts without echo, or reads stdin.",
  input: z.object({
    instance: z.string(),
    username: z
      .string()
      .optional()
      .describe("sign in as this user, and keep it as this clone's identity"),
  }),
  output: z.object({
    instance: z.string(),
    account: z.string(),
    username: z.string(),
    usernameSource: z.string().describe("environment, this clone or instance.yaml"),
    identityStored: z.boolean(),
    url: z.string(),
    kind: z.enum(INSTANCE_KINDS),
    stored: z.literal("keychain"),
  }),
  flags: {
    readOnly: false,
    destructive: false,
    requiresDevelopmentInstance: false,
    // Changes only the keychain, so it may run while a push holds the instance.
    locksWorkspace: false,
  },
  // Secrets never pass through an agent.
  mcp: false,
  arguments: ["instance"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const resolved = await getInstance(root, InstanceName.parse(input.instance), context.profiles);
    const profile = profileForLogin(resolved, input.username);
    const account = credentialAccount(profile);
    const secret = await context.secrets.read(`${secretName(profile)} for ${account}: `);
    const reader = context.connections.open(profile, secret);
    await login(profile, secret, context.credentials, reader, run.signal);
    const identityStored = await rememberIdentity(root, profile, context.identities);
    const { url, kind } = profile;
    return {
      instance: profile.name,
      account,
      username: profile.auth.username,
      usernameSource: usernameSourceLabel(profile),
      identityStored,
      url,
      kind,
      stored: "keychain" as const,
    };
  },
  render(output) {
    const stored = `stored credentials for ${output.account} in the OS keychain, for ${output.url} as a ${output.kind} instance`;
    return output.identityStored
      ? `${stored}\nthis clone signs in to ${output.instance} as ${output.username}`
      : stored;
  },
  exitCode: () => 0,
});
