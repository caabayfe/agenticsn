import { z } from "zod";

// The messages between snagentic and the Fluent SDK worker (ADR-0044). Both sides parse what they
// receive: the worker runs beside the project's code, so its messages are data, never trusted.

const ExchangeRequest = z.object({
  method: z.enum(["GET", "POST"]),
  url: z.string(),
  body: z.string().optional(),
});

const ExchangeAnswer = z.object({
  status: z.number().int(),
  contentType: z.string(),
  text: z.string(),
});

const BuildError = z.object({
  file: z.string(),
  line: z.number().int(),
  column: z.number().int(),
  code: z.string(),
  message: z.string(),
});

export const BuildOutcome = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), records: z.array(z.string()).readonly() }),
  z.object({ success: z.literal(false), errors: z.array(BuildError).readonly() }),
]);

export const TransformOutcome = z.discriminatedUnion("success", [
  z.object({ success: z.literal(true), files: z.array(z.string()).readonly() }),
  z.object({ success: z.literal(false), message: z.string() }),
]);

// From snagentic: one job, then the answers to the worker's instance requests.
export const ToWorker = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("build"), projectDir: z.string() }),
  z.object({
    kind: z.literal("transform"),
    projectDir: z.string(),
    records: z.array(z.object({ table: z.string(), sysId: z.string() })).readonly(),
    host: z.string(),
  }),
  z.object({ kind: z.literal("answer"), id: z.number().int(), answer: ExchangeAnswer }),
  z.object({ kind: z.literal("answer-failed"), id: z.number().int(), message: z.string() }),
]);

// From the worker: ready once the SDK is loaded, its instance requests, then one result.
export const FromWorker = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("ask"), id: z.number().int(), request: ExchangeRequest }),
  z.object({ kind: z.literal("built"), outcome: BuildOutcome }),
  z.object({ kind: z.literal("transformed"), outcome: TransformOutcome }),
  z.object({ kind: z.literal("failed"), message: z.string() }),
]);

export type ToWorker = z.infer<typeof ToWorker>;
export type FromWorker = z.infer<typeof FromWorker>;

// The hidden command that starts the release binary as the worker.
export const FLUENT_WORKER_COMMAND = "__fluent-worker";
