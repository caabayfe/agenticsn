import { InstanceName, push as pushPlan } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { NextCalls } from "./knowledge-schemas";
import { defineUseCase } from "./use-case";

export const push = defineUseCase({
  name: "push",
  description:
    "Deliver a reviewed plan to the development instance: writes the planned records into " +
    "the update set 'snagentic: <label> [<scope>]' (one per scope), then checks each was " +
    "captured. Only with the planId from plan_push and confirm=true, after the user approved " +
    "the plan. Refuses if anything changed since the plan, on the instance or in the workspace.",
  input: z.object({
    instance: z.string().describe("the development instance"),
    plan: z.string().describe("the planId from plan_push"),
    confirm: z.boolean().default(false).describe("true once the user approved the plan"),
    label: z.string().optional().describe("names the update sets (default: the git branch)"),
    allowCollisions: z.boolean().default(false),
  }),
  output: z.object({
    instance: z.string(),
    planId: z.string(),
    updateSets: z
      .array(
        z.object({
          scope: z.string(),
          name: z.string(),
          sysId: z.string(),
          created: z.boolean(),
          link: z.string(),
        }),
      )
      .readonly(),
    written: z
      .array(
        z.object({
          operation: z.string(),
          table: z.string(),
          sysId: z.string(),
          path: z.string(),
          captured: z.boolean(),
        }),
      )
      .readonly(),
    notCaptured: z.number(),
    next: NextCalls,
  }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: true,
  async handle(input, context, run) {
    const { root, name, profile, reader, pager } = await connect(
      context,
      input.instance,
      run.signal,
    );
    const catalog = await context.syncState(root, name).readCatalog();
    run.progress({ message: `pushing plan ${input.plan}` });
    const instance = InstanceName.parse(input.instance);
    return pushPlan(
      {
        workspace: context.delivery(root, instance),
        governance: context.governance(root, instance),
        updateSets: { pager, statistics: reader, now: context.clock },
        now: context.clock,
        signal: run.signal,
        reader,
        writer: reader.writer,
        journal: context.pushJournal(root, instance),
        catalog: catalog ?? { parents: {}, scopes: {}, typedFields: {} },
        username: profile.auth.username,
        url: profile.url,
      },
      {
        instance: name,
        planId: input.plan,
        confirm: input.confirm,
        allowCollisions: input.allowCollisions,
        ...(input.label === undefined ? {} : { label: input.label }),
      },
    );
  },
  render(output) {
    return [
      ...output.updateSets.map(
        (set) => `update set ${set.created ? "created" : "reused"}: ${set.name}  ${set.link}`,
      ),
      ...output.written.map(
        (w) =>
          `${w.operation.padEnd(6)} ${w.table}  ${w.path}${w.captured ? "" : "  NOT captured in the update set"}`,
      ),
      output.notCaptured === 0
        ? `pushed ${output.written.length} record(s); next: snagentic pull --instance ${output.instance}, then integrate`
        : `${output.notCaptured} write(s) were not captured in the update set: add them to it on the instance before moving it`,
    ].join("\n");
  },
  exitCode: (output) => (output.notCaptured === 0 ? 0 : 1),
});
