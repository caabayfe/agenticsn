import {
  addInstance,
  createProfile,
  INSTANCE_KINDS,
  InstanceName,
  instancePaths,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

export const instanceAdd = defineUseCase({
  group: "instance",
  name: "add",
  description:
    "Add a ServiceNow instance profile (URL, kind, user, and an OAuth client id when the " +
    "instance signs in an OAuth client) to this workspace. No secrets.",
  input: z.object({
    name: z.string().describe("short name used in commands and folders, e.g. dev or acme-prod"),
    url: z.string().describe("instance name (dev12345) or https address"),
    username: z
      .string()
      .describe("integration user; with --client-id, the client's OAuth Application User"),
    clientId: z
      .string()
      .optional()
      .describe("OAuth client id from the Application Registry, for the client-credentials grant"),
    kind: z.enum(INSTANCE_KINDS).default("development").describe("only development is written to"),
    acknowledgeReadOnly: z
      .boolean()
      .default(false)
      .describe("confirm that a test or production credential is read-only"),
  }),
  output: z.object({
    name: z.string(),
    url: z.string(),
    kind: z.enum(INSTANCE_KINDS),
    profile: z.string(),
    nextSteps: z.array(z.string()),
  }),
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["name"],
  async handle(input, context) {
    const root = await workspaceRoot(context);
    const { clientId, ...rest } = input;
    const profile = createProfile({
      ...rest,
      ...(clientId === undefined ? {} : { clientId }),
      name: InstanceName.parse(input.name),
    });
    await addInstance(root, profile, context.profiles);
    return {
      name: profile.name,
      url: profile.url,
      kind: profile.kind,
      profile: instancePaths(profile.name).profile,
      nextSteps: [`snagentic auth login ${profile.name}`],
    };
  },
  render(output) {
    return [
      `added ${output.name} (${output.kind}) ${output.url} -> ${output.profile}`,
      "next:",
      ...output.nextSteps.map((step) => `  ${step}`),
    ].join("\n");
  },
  exitCode: () => 0,
});
