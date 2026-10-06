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

// One piece of behavior on a table (describe, advise).
export const BehaviorItems = z
  .array(
    z.object({
      kind: z.string(),
      name: z.string(),
      order: z.number(),
      inactive: z.literal(true).optional(),
      path: z.string(),
      details: z.record(z.string(), z.string()),
      inheritedFrom: z.string().optional(),
    }),
  )
  .readonly();
