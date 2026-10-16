import { computePlan, InstanceName, packFindings, VERSION } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { NextCalls } from "./knowledge-schemas";
import { instanceFor } from "./knowledge-session";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const GateFinding = z.object({
  ruleId: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  path: z.string(),
  line: z.number().nullable(),
  message: z.string(),
});

const LAYOUT_NAMES = {
  list: "list",
  section: "form section",
  form: "form",
  related: "related lists",
} as const;

export const PlanOutput = z.object({
  instance: z.string(),
  planId: z.string(),
  mirrorCommit: z.string(),
  label: z.string(),
  updateSets: z.array(z.string()).readonly(),
  changes: z
    .array(
      z.object({
        operation: z.enum(["update", "create"]),
        table: z.string(),
        sysId: z.string(),
        scope: z.string(),
        path: z.string(),
        fields: z.array(z.string()).readonly(),
        elevated: z.boolean(),
        loaded: z
          .boolean()
          .describe(
            "loaded as its update through fluent/load: the platform does not record the Table API's writes of this class",
          ),
      }),
    )
    .readonly(),
  layouts: z
    .array(
      z.object({
        kind: z.enum(["list", "section", "form", "related"]),
        operation: z.enum(["update", "create"]),
        scope: z.string(),
        table: z.string(),
        view: z.string(),
        domain: z.string().describe('"global" or the sys_id of the domain the layout applies to'),
        sysId: z.string(),
        path: z.string(),
        rows: z
          .array(z.string())
          .readonly()
          .describe("columns, fields, sections or related lists, in order"),
      }),
    )
    .readonly()
    .describe(
      "lists, forms, form sections and related lists, each loaded whole with its rows in this order (ADR-0029, ADR-0030)",
    ),
  fluent: z
    .array(
      z.object({
        project: z.string(),
        scope: z.string(),
        table: z.string(),
        sysId: z.string(),
        name: z.string(),
        kind: z.string().describe("flow, subflow, action or record"),
      }),
    )
    .readonly()
    .describe("what each Fluent project's build installs, published after the scope's records"),
  problems: z.array(z.object({ path: z.string(), reason: z.string() })).readonly(),
  gate: z.object({
    passed: z.boolean(),
    blocking: z.array(GateFinding).readonly(),
    waived: z.array(GateFinding.extend({ reason: z.string(), approver: z.string() })).readonly(),
    warnings: z.number(),
    waiverProblems: z.array(z.object({ index: z.number(), reason: z.string() })).readonly(),
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

export const planPush = defineUseCase({
  name: "plan-push",
  mcpName: "plan_push",
  description:
    "Plan delivering the workspace's changes to the instance: the records and fields that " +
    "would change, the update sets they go into, the gate (validate plus waivers), and records " +
    "held in other open update sets. Writes nothing. Returns a planId for push when ready; " +
    "show the plan to the user before pushing.",
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
    const { pager, reader, elevatedSessions } = await connect(context, instance, run.signal);
    run.progress({ message: "planning the push" });
    const name = InstanceName.parse(instance);
    const { plan } = await computePlan(
      {
        workspace: context.delivery(root, name),
        journal: context.pushJournal(root, name),
        governance: context.governance(root, name),
        packGate: (paths) =>
          packFindings(
            {
              packs: context.packs,
              inventory: context.inventory,
              workspace: context.packWorkspace(root, name),
            },
            { instance: { root, name: name }, paths, snagentic: VERSION },
          ),
        fluent: context.fluentPackages(root),
        ...(reader.dictionary === undefined ? {} : { dictionary: reader.dictionary }),
        updateSets: { pager, statistics: reader, now: context.clock },
        elevation: elevatedSessions !== null,
        now: context.clock,
        signal: run.signal,
      },
      {
        instance,
        allowCollisions: input.allowCollisions,
        ...(input.label === undefined ? {} : { label: input.label }),
      },
    );
    return plan;
  },
  render(output) {
    const lines = [
      ...output.changes.map(
        (c) =>
          `${c.operation.padEnd(6)} ${c.table}  ${c.path}  (${c.fields.join(", ")})${c.elevated ? "  elevated: security_admin" : ""}${c.loaded ? "  loaded" : ""}`,
      ),
      ...output.layouts.map(
        (l) =>
          `${l.operation.padEnd(6)} ${LAYOUT_NAMES[l.kind]} ${l.table} (${l.view}${l.domain === "global" ? "" : `, domain ${l.domain}`})  ${l.path}  ${l.rows.join(", ")}`,
      ),
      ...output.fluent.map((f) => `${f.kind.padEnd(7)} ${f.name}  ${f.project}  (publish)`),
      ...output.problems.map((p) => `problem: ${p.path}: ${p.reason}`),
      ...output.gate.blocking.map(
        (f) => `blocked: ${f.ruleId} ${f.path}:${f.line ?? ""} ${f.message}`,
      ),
      ...output.gate.waived.map(
        (f) => `waived:  ${f.ruleId} ${f.path} (${f.approver}: ${f.reason})`,
      ),
      ...output.gate.waiverProblems.map((w) =>
        w.index < 0 ? w.reason : `waivers.yaml entry ${w.index + 1}: ${w.reason}`,
      ),
      ...output.collisions.map(
        (c) =>
          `held:    ${c.path} in ${c.heldBy.map((h) => `"${h.updateSetName}" (${h.updatedBy})`).join(", ")}`,
      ),
      `update sets: ${output.updateSets.join(", ") || "none"}`,
      output.ready
        ? `ready: snagentic push --instance ${output.instance} --plan ${output.planId} --confirm`
        : output.changes.length + output.layouts.length + output.fluent.length === 0
          ? "nothing to push"
          : "not ready: fix the items above, then plan again",
    ];
    return lines.join("\n");
  },
  exitCode: (output) =>
    output.ready || output.changes.length + output.layouts.length === 0 ? 0 : 1,
});
