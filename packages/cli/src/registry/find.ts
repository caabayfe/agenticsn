import { find as findRecords } from "@snagentic/core";
import { z } from "zod";
import { Freshness, NextCalls } from "./knowledge-schemas";
import { knowledgeSession } from "./knowledge-session";
import { defineUseCase } from "./use-case";

export const find = defineUseCase({
  name: "find",
  description:
    "Find where something lives in the mirrored instance: records by name (business rules, " +
    "script includes, tables, fields, ACLs…) or, with code=true, by text inside scripts. " +
    "Reads the workspace only. Follow up with describe on a result's path.",
  input: z.object({
    text: z.string().min(1).describe("words of the name, or the text to look for in code"),
    instance: z.string().optional().describe("default: the workspace's only instance"),
    code: z.boolean().default(false).describe("search inside scripts and long fields"),
    class: z.string().optional().describe("only records of this class, such as sys_script"),
    table: z.string().optional().describe("only behavior acting on this table"),
    scope: z.string().optional().describe("only records of this application scope"),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  output: Freshness.extend({
    instance: z.string(),
    total: z.number(),
    more: z.boolean(),
    records: z
      .array(
        z.object({
          path: z.string(),
          name: z.string(),
          className: z.string(),
          table: z.string().nullable(),
          scope: z.string(),
          active: z.boolean(),
          matches: z
            .array(z.object({ file: z.string(), line: z.number(), text: z.string() }))
            .readonly()
            .optional(),
          moreMatches: z.number().optional(),
        }),
      )
      .readonly(),
    next: NextCalls,
  }),
  flags: { readOnly: true, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["text"],
  async handle(input, context, run) {
    const deps = await knowledgeSession(context, input.instance, run.progress);
    const result = await findRecords(deps, {
      text: input.text,
      code: input.code,
      limit: input.limit,
      ...(input.class === undefined ? {} : { className: input.class }),
      ...(input.table === undefined ? {} : { table: input.table }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
    });
    return { instance: deps.instance, ...result };
  },
  render(output) {
    if (output.records.length === 0) {
      return `nothing found${output.next[0] === undefined ? "" : `; try: ${output.next[0].tool} ${JSON.stringify(output.next[0].args)}`}`;
    }
    const lines = output.records.flatMap((r) => [
      `${r.className.padEnd(24)} ${r.active ? "" : "(inactive) "}${r.name}  ${r.path}`,
      ...(r.matches ?? []).slice(0, 3).map((m) => `    ${m.file}:${m.line}  ${m.text}`),
    ]);
    return [
      ...lines,
      ...(output.more
        ? [`… ${output.total} in all; narrow with --class, --table or more words`]
        : []),
    ].join("\n");
  },
  exitCode: () => 0,
});
