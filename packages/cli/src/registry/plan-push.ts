import { computeUnitPlan } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { NextCalls } from "./knowledge-schemas";
import { instanceFor } from "./knowledge-session";
import { unitPlanDependencies } from "./unit-delivery";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const GateFinding = z.object({
  ruleId: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  path: z.string(),
  line: z.number().nullable(),
  message: z.string(),
});

export const PlanOutput = z.object({
  instance: z.string(),
  planId: z.string(),
  label: z.string(),
  updateSets: z.array(z.string()).readonly(),
  units: z
    .array(
      z.object({
        project: z.string(),
        scope: z.string(),
        updateName: z.string().describe("what the platform records the load as"),
        table: z.string(),
        sysId: z.string(),
        name: z.string(),
        operation: z
          .enum(["create", "load", "delete", "record", "forget"])
          .describe(
            "record: the instance already holds it as built; only the ledger is written. forget: gone from source and instance; only the ledger entry is dropped",
          ),
        ledger: z
          .string()
          .nullable()
          .optional()
          .describe(
            "the instance version when it last agreed with source; on a create, the record was deleted on the instance since and is created again",
          ),
        changes: z.array(z.string()).readonly().describe("table.field, or table rows"),
        losses: z
          .array(z.string())
          .readonly()
          .describe("known SDK losses the load also sets (not written in source)"),
        alsoSets: z
          .array(z.string())
          .readonly()
          .describe(
            "what those losses set, as table.field = value: the load sets it beyond source",
          ),
      }),
    )
    .readonly(),
  problems: z
    .array(
      z.object({
        project: z.string(),
        updateName: z.string(),
        kind: z.enum(["drift", "not-adopted", "unsafe", "removed", "build"]),
        reason: z.string(),
      }),
    )
    .readonly(),
  gate: z.object({
    passed: z.boolean(),
    blocking: z.array(GateFinding).readonly(),
    waived: z.array(GateFinding.extend({ reason: z.string(), approver: z.string() })).readonly(),
    warnings: z.number(),
    waiverProblems: z.array(z.object({ index: z.number(), reason: z.string() })).readonly(),
    inherited: z
      .array(GateFinding)
      .readonly()
      .optional()
      .describe(
        "findings the changed units already held where they last agreed with the instance: shown, never blocking",
      ),
  }),
  collisions: z
    .array(
      z.object({
        path: z.string(),
        record: z.string(),
        heldBy: z
          .array(
            z.object({ updateSet: z.string(), updateSetName: z.string(), updatedBy: z.string() }),
          )
          .readonly(),
      }),
    )
    .readonly(),
  ready: z.boolean(),
  next: NextCalls,
});

// What a reviewer must see beside a unit that is not an ordinary change (ADR-0033 as amended).
const NOTES = {
  again: "  (deleted on the instance since it last agreed with source: created again)",
  forget: "  (gone from source and from the instance: only its ledger entry is dropped)",
  none: "",
} as const;

const noteOf = (u: { operation: string; ledger?: string | null | undefined }) =>
  u.operation === "forget"
    ? "forget"
    : u.operation === "create" && u.ledger !== undefined && u.ledger !== null
      ? "again"
      : "none";

export const planPush = defineUseCase({
  name: "plan-push",
  mcpName: "plan_push",
  description:
    "Plan delivering the workspace's Fluent source to the instance: each unit (one update) " +
    "that would be created, loaded or deleted, compared with the instance's live copy, the " +
    "update sets it goes into, the gate (validate plus waivers), and records held in other " +
    "open update sets. Writes nothing. Returns a planId for push when ready; show the plan " +
    "to the user before pushing.",
  input: z.object({
    instance: z.string().optional().describe("default: the workspace's only instance"),
    label: z.string().optional().describe("names the update sets (default: the git branch)"),
    allowCollisions: z
      .boolean()
      .default(false)
      .describe("accept records already held in someone else's open update set"),
  }),
  output: PlanOutput,
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const instance = await instanceFor(root, context, input.instance);
    const connection = await connect(context, instance, run.signal);
    run.progress({ message: "building the source and reading the instance" });
    const { plan } = await computeUnitPlan(unitPlanDependencies(context, connection, run.signal), {
      instance: connection.name,
      allowCollisions: input.allowCollisions,
      ...(input.label === undefined ? {} : { label: input.label }),
    });
    return plan;
  },
  render(output) {
    const lines = [
      ...output.units.map(
        (u) =>
          `${u.operation.padEnd(6)} ${u.updateName}  ${u.project}${u.changes.length > 0 ? `  (${u.changes.join(", ")})` : ""}${u.alsoSets.length > 0 ? `  also sets: ${u.alsoSets.join(", ")}` : ""}${NOTES[noteOf(u)]}`,
      ),
      ...output.problems.map((p) => `problem: ${p.updateName || p.project}: ${p.reason}`),
      ...output.gate.blocking.map(
        (f) => `blocked: ${f.ruleId} ${f.path}:${f.line ?? ""} ${f.message}`,
      ),
      ...output.gate.waived.map(
        (f) => `waived:  ${f.ruleId} ${f.path} (${f.approver}: ${f.reason})`,
      ),
      ...(output.gate.inherited ?? []).map(
        (f) => `inherited (not blocking): ${f.ruleId} ${f.path}:${f.line ?? ""} ${f.message}`,
      ),
      ...output.gate.waiverProblems.map((w) =>
        w.index < 0 ? w.reason : `waivers.yaml entry ${w.index + 1}: ${w.reason}`,
      ),
      ...output.collisions.map(
        (c) =>
          `held:    ${c.record} in ${c.heldBy.map((h) => `"${h.updateSetName}" (${h.updatedBy})`).join(", ")}`,
      ),
      `update sets: ${output.updateSets.join(", ") || "none"}`,
      output.ready
        ? `ready: snagentic push --instance ${output.instance} --plan ${output.planId} --confirm`
        : output.units.length === 0 && output.problems.length === 0
          ? "nothing to push"
          : "not ready: fix the items above, then plan again",
    ];
    return lines.join("\n");
  },
  exitCode: (output) =>
    output.ready || output.units.length + output.problems.length === 0 ? 0 : 1,
});
