import { activatePlugin, ConfirmationRequiredError } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { defineUseCase } from "./use-case";

export const pluginsActivate = defineUseCase({
  group: "plugins",
  name: "activate",
  description:
    "Activate a plugin on a development instance with ServiceNow's CI/CD API, and follow it to the " +
    "end. Cannot be undone. Never retried: if the outcome is unclear, it says what to check.",
  input: z.object({
    instance: z.string(),
    id: z.string().describe("the plugin id, such as com.snc.incident_ai"),
    confirm: z.boolean().default(false).describe("confirm that this changes the instance"),
  }),
  output: z.object({
    instance: z.string(),
    id: z.string(),
    name: z.string(),
    state: z.enum(["activated", "already-active"]),
    progressId: z.string().nullable(),
    seconds: z.number(),
  }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: false,
  arguments: ["instance", "id"],
  async handle(input, context, run) {
    if (!input.confirm) {
      throw new ConfirmationRequiredError(`activating ${input.id}`);
    }
    const { name, pager, reader } = await connect(context, input.instance, run.signal);
    const deps = { pager, activator: reader.plugins, sleep: context.sleep, now: context.clock };
    const outcome = await activatePlugin(deps, name, input.id, run.signal, (progress) =>
      run.progress({
        message: `activating ${input.id}: ${progress.status}`,
        completed: progress.percent,
        total: 100,
      }),
    );
    return outcome.state === "already-active"
      ? {
          instance: name,
          id: input.id,
          name: outcome.name,
          state: outcome.state,
          progressId: null,
          seconds: 0,
        }
      : { instance: name, id: input.id, ...outcome };
  },
  render(output) {
    if (output.state === "already-active") {
      return `${output.id} (${output.name}) is already active on ${output.instance}; nothing was changed`;
    }
    return [
      `activated ${output.id} (${output.name}) on ${output.instance} in ${output.seconds} s (progress ${output.progressId})`,
      `next: snagentic pull ${output.instance}  (brings in what the plugin installed)`,
    ].join("\n");
  },
  exitCode: () => 0,
});
