import { ConfirmationRequiredError, installStoreApp } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

// Store applications through the platform's installer (spec 011, I3; ADR-0038, section 4). CLI
// only: the MCP budget is full, and accelerator install calls it as one of its steps.
export const appsInstall = defineUseCase({
  group: "apps",
  name: "install",
  description:
    "Install a store application the instance's store offers on a development instance, with " +
    "ServiceNow's CI/CD API, and follow it to the end: the version named, or the store's latest. " +
    "With --demo-data it also loads the application's own demo data. Never upgrades, never " +
    "retried. Cannot be undone by snagentic.",
  input: z.object({
    instance: z.string(),
    scope: z.string().describe("the application's scope, such as sn_ztsd"),
    version: z
      .string()
      .optional()
      .describe("the version to install; the store's latest when absent"),
    demoData: z
      .boolean()
      .default(false)
      .describe("also load the application's demo data, which snagentic cannot remove"),
    confirm: z.boolean().default(false).describe("confirm that this changes the instance"),
  }),
  output: z.object({
    instance: z.string(),
    scope: z.string(),
    name: z.string(),
    version: z.string(),
    state: z.enum(["installed", "already-installed"]),
    progressId: z.string().nullable(),
    seconds: z.number(),
  }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: false,
  arguments: ["instance", "scope"],
  async handle(input, context, run) {
    if (!input.confirm) {
      throw new ConfirmationRequiredError(`installing ${input.scope}`);
    }
    const { name, pager, reader } = await connect(context, input.instance, run.signal);
    const deps = { pager, installer: reader.apps, sleep: context.sleep, now: context.clock };
    const outcome = await installStoreApp(
      deps,
      name,
      input.scope,
      { version: input.version ?? null, demoData: input.demoData },
      run.signal,
      (progress) =>
        run.progress({
          message: `installing ${input.scope}: ${progress.status}`,
          completed: progress.percent,
          total: 100,
        }),
    );
    return outcome.state === "already-installed"
      ? { instance: name, scope: input.scope, ...outcome, progressId: null, seconds: 0 }
      : { instance: name, scope: input.scope, ...outcome };
  },
  render(output) {
    if (output.state === "already-installed") {
      return `${output.scope} (${output.name}) ${output.version} is already installed on ${output.instance}; nothing was changed`;
    }
    return [
      `installed ${output.scope} (${output.name}) ${output.version} on ${output.instance} in ${output.seconds} s (progress ${output.progressId})`,
      `next: snagentic pull ${output.instance}  (brings in what the application installed)`,
    ].join("\n");
  },
  exitCode: () => 0,
});
