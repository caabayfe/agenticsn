import { queryLiveTable, TableName } from "@snagentic/core";
import { z } from "zod";
import { connect } from "./connect";
import { liveFields, liveFlags, livePredicate, liveRow, liveTarget } from "./live-query-schemas";
import { defineUseCase } from "./use-case";

export const queryTable = defineUseCase({
  name: "table",
  group: "query",
  mcpName: "query_table",
  mcp: false,
  mcpProfiles: ["investigate"],
  description:
    "Read a bounded live table page without pulling the mirror. Validates fields and selective predicates against the live schema, masks secrets, and returns a query-bound keyset cursor. ^OR joins adjacent alternatives; ^NQ joins whole groups. No generic REST or writes. Results are ACL-limited, transient observations.",
  help: {
    summary: "Read a bounded live table page",
    section: "Understand",
    group: "Read live ServiceNow data",
    details:
      "Read explicit fields with a selective literal filter. Use the returned cursor with the same query, fields and limit for another page. No mirror pull is required.",
    effects: "Reads live schema and records; masks secrets; writes no records or local files.",
    examples: [
      [
        "query",
        "table",
        "--instance",
        "dev",
        "--table",
        "incident",
        "--fields",
        "sys_id",
        "number",
        "--query",
        "sys_id=0123456789abcdef0123456789abcdef",
      ],
    ],
  },
  input: z.object({
    ...liveTarget,
    fields: liveFields,
    query: livePredicate,
    limit: z.number().int().min(1).max(100).default(10).describe("maximum returned rows"),
    cursor: z
      .string()
      .max(100)
      .optional()
      .describe("nextCursor from the same instance, query, fields and limit"),
  }),
  output: z.object({
    table: z.string(),
    fields: z.array(z.string()),
    rows: z.array(liveRow),
    nextCursor: z.string().nullable(),
    truncated: z.boolean(),
    note: z.string(),
  }),
  flags: liveFlags,
  async handle(input, context, run) {
    const { reader, profile } = await connect(context, input.instance, run.signal);
    return queryLiveTable(
      reader,
      {
        ...input,
        table: TableName.parse(input.table),
        source: JSON.stringify([profile.url, profile.auth.username]),
      },
      run.signal,
    );
  },
  render: (output) => JSON.stringify(output, null, 2),
  exitCode: () => 0,
});
