import {
  describeRecord,
  describeTable,
  type KnowledgeDependencies,
  PHASE_ORDER,
  type RecordDescription,
  type TableDescription,
} from "@snagentic/core";
import { z } from "zod";
import { Freshness, NextCalls } from "./knowledge-schemas";
import { knowledgeSession } from "./knowledge-session";
import { defineUseCase } from "./use-case";

const Details = z.record(z.string(), z.string());
const Behavior = z
  .array(
    z.object({
      kind: z.string(),
      name: z.string(),
      order: z.number(),
      active: z.boolean(),
      path: z.string(),
      details: Details,
      inheritedFrom: z.string().optional(),
    }),
  )
  .readonly();

const TableOutput = Freshness.extend({
  table: z.string(),
  known: z.boolean(),
  inherits: z.array(z.string()).readonly(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        type: z.string(),
        label: z.string(),
        reference: z.string(),
        mandatory: z.boolean(),
        definedOn: z.string(),
        path: z.string(),
      }),
    )
    .readonly(),
  behavior: z.record(z.string(), Behavior),
  omitted: z.record(z.string(), z.number()),
  counts: z.record(z.string(), z.number()),
  notCovered: z.array(z.string()).readonly(),
  next: NextCalls,
});

const RecordOutput = Freshness.extend({
  path: z.string(),
  sysId: z.string(),
  className: z.string(),
  name: z.string(),
  scope: z.string(),
  table: z.string().nullable(),
  active: z.boolean(),
  updatedOn: z.string(),
  details: Details,
  files: z.array(z.string()).readonly(),
  usedBy: z
    .array(
      z.object({
        path: z.string(),
        name: z.string(),
        className: z.string(),
        line: z.number(),
        text: z.string(),
      }),
    )
    .readonly(),
  usedByMore: z.boolean(),
  next: NextCalls,
});

// A table name, unless the target looks like a record path or is not a known table.
async function describeTarget(deps: KnowledgeDependencies, target: string, inactive: boolean) {
  const isPath = target.includes("/") || target.endsWith(".yaml");
  if (!isPath && deps.catalog?.parents[target] !== undefined) {
    return { kind: "table" as const, table: await describeTable(deps, target, inactive) };
  }
  if (!isPath && (await deps.store.bySysId(target)) === null) {
    return { kind: "table" as const, table: await describeTable(deps, target, inactive) };
  }
  return { kind: "record" as const, record: await describeRecord(deps, target) };
}

function renderTable(t: TableDescription): string[] {
  const lines = [
    `${t.table}${t.known ? "" : " (not a table in the catalog)"} — inherits ${t.inherits.slice(1).join(" → ") || "nothing"}; ${t.fields.length} fields`,
  ];
  for (const phase of PHASE_ORDER) {
    const items = t.behavior[phase] ?? [];
    if (items.length === 0 && t.omitted[phase] === undefined) {
      continue;
    }
    lines.push(`  ${phase}:`);
    for (const b of items) {
      const from = b.inheritedFrom === undefined ? "" : ` (from ${b.inheritedFrom})`;
      lines.push(`    ${String(b.order).padStart(5)}  ${b.kind}: ${b.name}${from}  ${b.path}`);
    }
    if (t.omitted[phase] !== undefined) {
      lines.push(`    … ${t.omitted[phase]} more (inactive, or beyond the first ${items.length})`);
    }
  }
  return lines;
}

function renderRecord(r: RecordDescription): string[] {
  return [
    `${r.className}: ${r.name}${r.active ? "" : " (inactive)"}  ${r.path}`,
    ...(r.table === null ? [] : [`  acts on ${r.table}`]),
    ...r.files.map((file) => `  file: ${file}`),
    ...r.usedBy.map((u) => `  used by ${u.className}: ${u.name}  ${u.path}:${u.line}`),
    ...(r.usedByMore ? ["  … used in more places; search with: find --code"] : []),
  ];
}

export const describe = defineUseCase({
  name: "describe",
  description:
    "Describe a table or a record of the mirrored instance. A table: its fields and everything " +
    "that runs on it, in execution order (client scripts, UI policies, business rules before/" +
    "after/async, notifications, ACLs), including what it inherits. A record (path or sys_id): " +
    "its files and what refers to it. Reads the workspace only.",
  input: z.object({
    target: z.string().min(1).describe("a table name, a record path, or a sys_id"),
    instance: z.string().optional().describe("default: the workspace's only instance"),
    inactive: z.boolean().default(false).describe("tables: also list inactive behavior"),
  }),
  output: z.object({
    instance: z.string(),
    kind: z.enum(["table", "record"]),
    table: TableOutput.optional(),
    record: RecordOutput.optional(),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["target"],
  async handle(input, context, run) {
    const deps = await knowledgeSession(context, input.instance, run.progress);
    return {
      instance: deps.instance,
      ...(await describeTarget(deps, input.target, input.inactive)),
    };
  },
  render(output) {
    const lines =
      output.table !== undefined
        ? renderTable(output.table)
        : output.record !== undefined
          ? renderRecord(output.record)
          : [];
    const freshness = output.table ?? output.record;
    return [
      ...lines,
      ...(freshness?.stale
        ? [`(mirror as of ${freshness.asOf ?? "never"} UTC: consider snagentic pull)`]
        : []),
    ].join("\n");
  },
  exitCode: () => 0,
});
