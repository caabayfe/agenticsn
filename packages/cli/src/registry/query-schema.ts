import { queryLiveSchema, TableName } from "@snagentic/core";
import { z } from "zod";
import { liveQueryAccess } from "./live-query-access";
import { liveFlags, liveTarget } from "./live-query-schemas";
import { defineUseCase } from "./use-case";

export const querySchema = defineUseCase({
  name: "schema",
  group: "query",
  mcpName: "table_schema",
  mcp: false,
  mcpProfiles: ["investigate"],
  description:
    "Inspect live fields declared on a table and inherited from its parents, with types, references and unique markers. Pages the dictionary; refuses incomplete, cyclic or over-budget reads. Does not enumerate child tables. Credential visibility limits what can be observed.",
  help: {
    summary: "Inspect live inherited table fields",
    section: "Understand",
    group: "Read live ServiceNow data",
    details:
      "Read the live dictionary through the parent chain. Pages fields instead of silently truncating at 1000. Does not list descendants.",
    effects:
      "Reads table definitions and dictionary fields; writes no records. Adds one line to the local query log.",
    examples: [["query", "schema", "--instance", "dev", "--table", "incident"]],
  },
  input: z.object(liveTarget),
  output: z.object({
    table: z.string(),
    ancestors: z.array(z.string()).readonly(),
    fields: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          reference: z.string(),
          unique: z.boolean(),
          declaredOn: z.string(),
        }),
      )
      .readonly(),
    complete: z.boolean(),
  }),
  flags: liveFlags,
  async handle(input, context, run) {
    const access = await liveQueryAccess(context, input.instance, run.signal);
    return queryLiveSchema(access, TableName.parse(input.table), run.signal);
  },
  render: (output) => JSON.stringify(output, null, 2),
  exitCode: () => 0,
});
