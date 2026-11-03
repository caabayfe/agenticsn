import type { Row } from "@snagentic/core";
import { z } from "zod";

// The shapes snagentic reads from the instance's answers, checked before use: only the fields
// read, and nothing else (an instance may add fields; it may not change these).

// Raw values and no reference links: every field is text (ADR-0016). Some instances answer a
// field with no readable value as null (a compressed field on a newer PDI): that is empty text.
const FieldValue = z
  .string()
  .nullable()
  .transform((value) => value ?? "");

export const Rows: z.ZodType<Row[], unknown> = z.array(z.record(z.string(), FieldValue));

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

// The page a hibernating developer instance answers with: its title, or its redirect to the
// developer portal's wake-up link.
export function isHibernationPage(body: string): boolean {
  return (
    /Instance Hibernating page/i.test(body) || /developer\.servicenow\.com[^"']*wu=true/.test(body)
  );
}

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

// The instance's own words about a failed request, from either error body; never the raw body.
export function errorMessage(body: string): string {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return "no details";
  }
  const parsed = ErrorBody.safeParse(raw);
  if (!parsed.success) {
    return "no details";
  }
  const { error, result } = parsed.data;
  const table = [text(error?.message), text(error?.detail)].filter(Boolean).join(": ");
  return table || text(result?.error) || "no details";
}

export function countOf(result: StatsResult): number | null {
  const count = Number(result.stats?.count);
  return Number.isInteger(count) && count >= 0 ? count : null;
}
