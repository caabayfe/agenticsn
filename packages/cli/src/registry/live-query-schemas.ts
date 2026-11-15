import { z } from "zod";

export const liveTarget = {
  instance: z
    .string()
    .describe(
      "configured instance profile; test/production require a verified read-only credential",
    ),
  table: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .describe("table name, validated against the live dictionary"),
};
export const liveFields = z
  .array(z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){0,2}$/))
  .min(1)
  .max(40)
  .describe("explicit field names; at most two reference hops, no wildcard");
export const livePredicate = z
  .string()
  .min(1)
  .max(4096)
  .describe(
    "literal encoded query: each NQ branch needs sys_id/unique equality or IN, or explicit UTC sys_updated_on bounds within 31 days; no JavaScript/dynamic filters",
  );
export const liveRow = z.record(z.string(), z.string());
export const liveFlags = {
  readOnly: true,
  destructive: false,
  requiresDevelopmentInstance: false,
} as const;
