import type { Row } from "@snagentic/core";
import { z } from "zod";

// The shapes snagentic reads from the instance's answers, checked before use: only the fields
// read, and nothing else (an instance may add fields; it may not change these).

// Raw values and no reference links: every field is text (ADR-0016).
export const Rows: z.ZodType<Row[]> = z.array(z.record(z.string(), z.string()));

const Stats = z.object({
  count: z.string().optional(),
  max: z.record(z.string(), z.string()).optional(),
  sum: z.record(z.string(), z.string()).optional(),
});

// The Aggregate API's answer, alone or one per group.
export const StatsResult = z.object({
  stats: Stats.optional(),
  groupby_fields: z.array(z.object({ field: z.string(), value: z.string() })).optional(),
});
export type StatsResult = z.infer<typeof StatsResult>;

export const GroupedStats = z.array(StatsResult);

// Error bodies: the Table API's { error: { message, detail } }; the Fluent endpoints'
// { result: { error } }. Anything else has no details to show.
export const ErrorBody = z.object({
  error: z.object({ message: z.unknown(), detail: z.unknown() }).partial().optional(),
  result: z.object({ error: z.unknown() }).partial().nullable().optional(),
});

// Where an answer first differs from the expected shape, for the error message.
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue === undefined ? "unexpected content" : `${issue.path.join(".")}: ${issue.message}`;
}
