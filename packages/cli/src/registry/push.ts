import { InstanceName, pushUnits } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { NextCalls } from "./knowledge-schemas";
import { installerOf, unitPlanDependencies } from "./unit-delivery";
import { defineUseCase } from "./use-case";

// What the batch is linked to on the git platform (ADR-0022).
function pullRequestLine(pr: {
  readonly status: string;
  readonly url?: string | undefined;
  readonly reason?: string | undefined;
}): string {
  switch (pr.status) {
    case "created":
      return `draft pull request opened: ${pr.url ?? ""}`;
    case "none":
      return "no pull request for this branch yet: push with --draft-pr to open one";
    case "unavailable":
      return `no pull request linked: ${pr.reason ?? ""}`;
    default:
      return `pull request: ${pr.url ?? ""}`;
  }
}

export const push = defineUseCase({
  name: "push",
  description:
    "Deliver a reviewed plan to the development instance: loads the planned units of the " +
    "Fluent source (fluent/load) into " +
    "the branch's update set batch, 'snagentic: <label>' (global changes) with a child " +
    "'snagentic: <label> [<scope>]' per other scope, checks each was captured and reads it " +
    "back, then commits the ledgers. Pass pr " +
    "to name the branch's pull request; otherwise its open one is linked when the GitHub CLI " +
    "is signed in. draftPr opens a draft pull request first when there is none (the planned " +
    "changes must be committed). Only with the planId from plan_push and confirm=true, after the user approved " +
    "the plan. Refuses if anything changed since the plan, on the instance or in the workspace.",
  input: z.object({
    instance: z.string().describe("the development instance"),
    plan: z.string().describe("the planId from plan_push"),
    confirm: z.boolean().default(false).describe("true once the user approved the plan"),
    label: z.string().optional().describe("names the update sets (default: the git branch)"),
    pr: z
      .string()
      .regex(/^https?:\/\/\S+$/, "a pull request URL")
      .optional()
      .describe("the branch's pull request (default: found with the GitHub CLI)"),
    draftPr: z
      .boolean()
      .default(false)
      .describe("open a draft pull request when the branch has none (needs committed changes)"),
    allowCollisions: z.boolean().default(false),
  }),
  output: z.object({
    instance: z.string(),
    planId: z.string(),
    pullRequest: z.object({
      status: z.enum(["given", "found", "created", "none", "unavailable"]),
      url: z.string().optional(),
      reason: z.string().optional(),
    }),
    batch: z.object({
      name: z.string(),
      sysId: z.string(),
      created: z.boolean(),
      link: z.string(),
    }),
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
    units: z
      .array(
        z.object({
          project: z.string(),
          updateName: z.string(),
          table: z.string(),
          name: z.string(),
          operation: z.enum(["create", "load", "delete", "record"]),
          captured: z.boolean().describe("recorded in the update set under its update name"),
          applied: z.boolean().describe("read back, the instance holds what the build loaded"),
        }),
      )
      .readonly(),
    notCaptured: z.number(),
    notApplied: z.number(),
    ledgerCommit: z
      .string()
      .nullable()
      .describe("the commit of the ledgers: what each unit now agrees with on the instance"),
    next: NextCalls,
  }),
  flags: { readOnly: false, destructive: true, requiresDevelopmentInstance: true },
  mcp: true,
  async handle(input, context, run) {
    const connection = await connect(context, input.instance, run.signal);
    const { root, profile, reader } = connection;
    run.progress({ message: `pushing plan ${input.plan}` });
    const instance = InstanceName.parse(input.instance);
    return pushUnits(
      {
        ...unitPlanDependencies(context, connection, run.signal),
        workspace: context.delivery(root, instance),
        reader,
        writer: reader.writer,
        journal: context.pushJournal(root, instance),
        username: profile.auth.username,
        url: profile.url,
        pullRequests: context.pullRequests(root),
        installer: installerOf(connection),
      },
      {
        instance: connection.name,
        planId: input.plan,
        confirm: input.confirm,
        allowCollisions: input.allowCollisions,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.pr === undefined ? {} : { pr: input.pr }),
        draftPr: input.draftPr,
      },
    );
  },
  render(output) {
    return [
      `batch ${output.batch.created ? "created" : "reused"}: ${output.batch.name}  ${output.batch.link}`,
      pullRequestLine(output.pullRequest),
      ...output.updateSets
        .filter((set) => set.sysId !== output.batch.sysId)
        .map((set) => `update set ${set.created ? "created" : "reused"}: ${set.name}  ${set.link}`),
      ...output.units.map(
        (u) =>
          `${u.operation.padEnd(6)} ${u.updateName}${u.captured ? "" : "  NOT captured in the update set"}${u.applied ? "" : "  NOT applied as built"}`,
      ),
      output.ledgerCommit === null
        ? "no ledger change"
        : `ledger committed: ${output.ledgerCommit.slice(0, 10)}`,
      output.notCaptured + output.notApplied === 0
        ? `pushed ${output.units.length} unit(s)`
        : `${output.notCaptured} load(s) not captured, ${output.notApplied} not applied as built: check them on the instance before moving the update set`,
    ].join("\n");
  },
  exitCode: (output) => (output.notCaptured + output.notApplied === 0 ? 0 : 1),
});
