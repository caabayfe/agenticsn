import { getLiveRecord, TableName } from "@snagentic/core";
import { z } from "zod";
import { liveQueryAccess } from "./live-query-access";
import { liveFields, liveFlags, liveRow, liveTarget } from "./live-query-schemas";
import { defineUseCase } from "./use-case";

export const queryRecord = defineUseCase({
  name: "record",
  group: "query",
  mcpName: "get_record",
  mcp: false,
  mcpProfiles: ["investigate"],
  description:
    "Read explicit fields of one live record by sys_id, with schema validation and secret redaction. Returns null for absent or ACL-hidden records; no mirror pull required.",
  help: {
    summary: "Read one live record",
    section: "Understand",
    group: "Read live ServiceNow data",
    details:
      "Read explicit fields by table and sys_id. A missing or ACL-hidden record returns null.",
    effects:
      "Reads live schema and one record; writes no records. Adds one line to the local query log.",
    examples: [
      [
        "query",
        "record",
        "--instance",
        "dev",
        "--table",
        "incident",
        "--sys-id",
        "0123456789abcdef0123456789abcdef",
        "--fields",
        "number",
        "active",
      ],
    ],
  },
  input: z.object({
    ...liveTarget,
    fields: liveFields,
    sysId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .describe("record sys_id"),
  }),
  output: z.object({
    table: z.string(),
    record: liveRow.nullable(),
    truncated: z.boolean(),
    note: z.string(),
  }),
  flags: liveFlags,
  async handle(input, context, run) {
    const access = await liveQueryAccess(context, input.instance, run.signal);
    return getLiveRecord(access, { ...input, table: TableName.parse(input.table) }, run.signal);
  },
  render: (output) => JSON.stringify(output, null, 2),
  exitCode: () => 0,
});
