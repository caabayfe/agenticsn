import { z } from "zod";

// Shared result parts of the knowledge tools (design 3.1).
export const Freshness = z.object({
  asOf: z.string().nullable().describe("raw UTC time of the last pull behind this answer"),
  stale: z.boolean().describe("true when the mirror is old: consider pull before relying on it"),
});

export const NextCalls = z
  .array(
    z.object({ tool: z.string(), args: z.record(z.string(), z.union([z.string(), z.boolean()])) }),
  )
  .readonly();
