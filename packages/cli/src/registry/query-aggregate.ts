import { aggregateLiveTable, TableName } from "@snagentic/core";
import { z } from "zod";
import { liveQueryAccess } from "./live-query-access";
import { liveFlags, livePredicate, liveTarget } from "./live-query-schemas";
import { defineUseCase } from "./use-case";

export const queryAggregate = defineUseCase({
  name: "aggregate",
  group: "query",
  mcpName: "aggregate",
  mcp: false,
  mcpProfiles: ["investigate"],
  description:
    "Count live records matching a validated selective literal filter, optionally by one non-sensitive direct field. Maximum 100 groups; narrow the filter if exceeded. Returns counts, not records. Supports count only.",
  help: {
    summary: "Count live records or groups",
    section: "Understand",
    group: "Read live ServiceNow data",
    details:
      "Count matches, optionally grouped by one non-sensitive field. Supports count only; refuses more than 100 groups.",
    effects:
      "Reads live schema and aggregate counts; writes no records. Adds one line to the local query log.",
    examples: [
      [
        "query",
        "aggregate",
        "--instance",
        "dev",
        "--table",
        "incident",
        "--query",
        "sys_id=0123456789abcdef0123456789abcdef",
      ],
    ],
  },
  input: z.object({
    ...liveTarget,
    query: livePredicate,
    groupBy: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/)
      .optional()
      .describe("one direct non-sensitive grouping field"),
  }),
  output: z.object({
    table: z.string(),
    count: z.number(),
    groups: z.array(z.object({ value: z.string(), count: z.number() })),
    note: z.string(),
  }),
  flags: liveFlags,
  async handle(input, context, run) {
    const access = await liveQueryAccess(context, input.instance, run.signal);
    return aggregateLiveTable(
      access,
      { ...input, table: TableName.parse(input.table) },
      run.signal,
    );
  },
  render: (output) => JSON.stringify(output, null, 2),
  exitCode: () => 0,
});
