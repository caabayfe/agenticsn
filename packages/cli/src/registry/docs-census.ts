import { docsCensus as takeDocsCensus } from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
import { workspaceRoot } from "./workspace-root";

const Group = z.object({
  scope: z.string(),
  title: z.string(),
  records: z.number(),
  items: z
    .array(z.object({ kind: z.string(), count: z.number(), names: z.array(z.string()).readonly() }))
    .readonly(),
  features: z
    .array(z.string())
    .readonly()
    .describe("features.yaml features naming the application"),
});

const NAMES_SHOWN = 6;

export const docsCensus = defineUseCase({
  group: "docs",
  name: "census",
  description:
    "List every application that reaches a documented process's tables, from the mirror: form " +
    "and workspace actions (also those on the tables they extend, such as task), business rules, " +
    "client scripts, UI policies, notifications, SLA definitions, and tables that refer to the " +
    "process. Each application must be named by a feature in processes/<process>/features.yaml " +
    "(documented, todo, out-of-scope or question); the ones no feature names are listed as " +
    "undecided. Features only visible on screen (workspace buttons, side panels) are found by " +
    "walking the form as each role. Reads only the mirror.",
  input: z.object({
    process: z.string().describe("the process id, as in documentation/processes/<process>/"),
  }),
  output: z.object({
    process: z.string(),
    tables: z.array(z.string()).readonly(),
    groups: z.array(Group).readonly(),
    undecided: z
      .array(Group.omit({ features: true }))
      .readonly()
      .describe("what no feature claims"),
    declared: z.boolean().describe("the process has a features.yaml"),
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: false,
  arguments: ["process"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    run.progress({ message: "reading the mirror for everything that reaches the process" });
    const docs = context.documentation(root);
    const census = await takeDocsCensus({ ...docs, root, signal: run.signal }, input.process);
    return {
      process: census.process,
      tables: census.tables,
      groups: census.groups,
      undecided: census.undecided,
      declared: census.declared !== null,
    };
  },
  render(output) {
    const names = (list: readonly string[]) =>
      `${list.slice(0, NAMES_SHOWN).join(", ")}${list.length > NAMES_SHOWN ? `, … ${list.length - NAMES_SHOWN} more` : ""}`;
    const lines = output.groups.flatMap((group) => [
      `${group.title} (${group.scope}): ${group.records} records${group.features.length === 0 ? "" : `  → ${group.features.join(", ")}`}`,
      ...group.items.map((item) => `  ${item.kind} (${item.count}): ${names(item.names)}`),
    ]);
    const open = output.undecided.flatMap((group) =>
      group.items.map((item) => `  ${group.scope}  ${item.kind}: ${names(item.names)}`),
    );
    const head = `census of ${output.process} (${output.tables.join(", ")}): ${output.groups.length} applications`;
    const next = output.declared
      ? open.length === 0
        ? ["", "every application has a decision in features.yaml"]
        : ["", "undecided (claim each in features.yaml, as <scope> or <scope>:<name>):", ...open]
      : [
          "",
          `next: write documentation/processes/${output.process}/features.yaml with a decision for each application, then walk the form as each role for what the mirror can't show`,
        ];
    return [head, "", ...lines, ...next].join("\n");
  },
  exitCode: () => 0,
});
