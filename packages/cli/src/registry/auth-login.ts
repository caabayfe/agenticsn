import {
  credentialAccount,
  getInstance,
  INSTANCE_KINDS,
  InstanceName,
  login,
  secretName,
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
    "Prompts without echo, or reads stdin. allowElevation lets push write ACLs through a " +
    "browser session elevated to security_admin (ADR-0024): development instances with Basic " +
    "authentication only, for a user who holds security_admin.",
  input: z.object({
    instance: z.string(),
    allowElevation: z
      .boolean()
      .default(false)
      .describe("let push elevate to security_admin to write ACLs (needs Chrome or Edge)"),
  }),
  output: z.object({
    instance: z.string(),
    account: z.string(),
    url: z.string(),
    kind: z.enum(INSTANCE_KINDS),
    elevation: z.boolean(),
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
    const secret = await context.secrets.read(`${secretName(profile)} for ${account}: `);
    const reader = context.connections.open(profile, secret);
    const elevation = input.allowElevation;
    await login(profile, secret, context.credentials, reader, run.signal, {
      allowElevation: elevation,
    });
    const { url, kind } = profile;
    return { instance: profile.name, account, url, kind, elevation, stored: "keychain" as const };
  },
  render(output) {
    const stored = `stored credentials for ${output.account} in the OS keychain, for ${output.url} as a ${output.kind} instance`;
    return output.elevation
      ? `${stored}; elevated writes allowed: push writes ACLs through a session elevated to security_admin`
      : stored;
  },
  exitCode: () => 0,
});
