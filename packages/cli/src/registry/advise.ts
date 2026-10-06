import { advise as adviseOn } from "@snagentic/core";
import { z } from "zod";
import { BehaviorItems, Freshness, NextCalls } from "./knowledge-schemas";
import { knowledgeSession } from "./knowledge-session";
import { defineUseCase } from "./use-case";

const Strings = z.array(z.string()).readonly();

const Output = Freshness.extend({
  instance: z.string(),
  intents: z.array(z.object({ id: z.string(), label: z.string() })).readonly(),
  ladder: z
    .array(
      z.object({
        option: z.string(),
        customization: z.enum(["configuration", "low-code", "script"]),
        classes: Strings,
        when: z.string(),
        fit: z.enum(["likely", "possible", "last resort"]),
        evidence: z.string().nullable(),
      }),
    )
    .readonly(),
  facts: z
    .array(
      z.object({
        table: z.string(),
        known: z.boolean(),
        inherits: Strings,
        counts: z.record(z.string(), z.number()),
        related: BehaviorItems,
      }),
    )
    .readonly(),
  guidance: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        text: z.string(),
        phases: Strings,
        classes: Strings.optional(),
        rules: Strings.optional(),
      }),
    )
    .readonly(),
  rules: z
    .array(
      z.object({
        id: z.string(),
        category: z.string(),
        severity: z.enum(["block", "warn", "info"]),
        title: z.string(),
        why: z.string(),
        remediation: z.string(),
        scripts: Strings,
        classes: Strings.optional(),
      }),
    )
    .readonly(),
  designRecord: z.string().nullable(),
  next: NextCalls,
});

function render(output: z.output<typeof Output>): string {
  const lines: string[] = [];
  lines.push(
    output.intents.length === 0
      ? "request not recognised: general guidance only"
      : `recognised: ${output.intents.map((i) => i.label).join("; ")}`,
  );
  for (const step of output.ladder) {
    lines.push(
      `  [${step.fit}] ${step.option} (${step.customization}) — ${step.when}${step.evidence === null ? "" : `; ${step.evidence}`}`,
    );
  }
  for (const fact of output.facts) {
    lines.push(
      `${fact.table}: ${
        Object.entries(fact.counts)
          .map(([phase, n]) => `${n} ${phase}`)
          .join(", ") || "no behavior"
      }`,
    );
    lines.push(...fact.related.map((r) => `  ${r.kind}: ${r.name}  ${r.path}`));
  }
  lines.push(...output.guidance.map((g) => `[${g.id}] ${g.title}: ${g.text}`));
  lines.push(...output.rules.map((r) => `[${r.id}][${r.severity}] ${r.title} → ${r.remediation}`));
  if (output.designRecord !== null) {
    lines.push("Design record:", output.designRecord);
  }
  return lines.join("\n");
}

export const advise = defineUseCase({
  name: "advise",
  description:
    "Advise on a ServiceNow change before or while making it. Give the request in the user's " +
    "words and the tables involved. Returns the platform's options least custom first (each " +
    "marked likely, possible or last resort, with what already exists on those tables), the " +
    "ServiceNow guidance and rules that apply, and in the design phase a design record to fill. " +
    "Reads the workspace only.",
  input: z.object({
    intent: z.string().min(1).describe("the request, in the user's words"),
    tables: z.array(z.string()).default([]).describe("tables the change is about"),
    phase: z
      .enum(["design", "build", "review"])
      .default("design")
      .describe("design before editing, build while editing, review before delivering"),
    classes: z
      .array(z.string())
      .default([])
      .describe("build and review: classes being changed, such as sys_script"),
    instance: z.string().optional().describe("default: the workspace's only instance"),
  }),
  output: Output,
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["intent"],
  async handle(input, context, run) {
    const deps = await knowledgeSession(context, input.instance, run.progress);
    const advice = await adviseOn(deps, {
      intent: input.intent,
      targets: input.tables,
      phase: input.phase,
      classes: input.classes,
    });
    return { instance: deps.instance, ...advice };
  },
  render: (output) => render(output),
  exitCode: () => 0,
});
