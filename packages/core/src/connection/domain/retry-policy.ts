export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOutcome {
  readonly status?: number;
  readonly networkError?: boolean;
  readonly retryAfter?: string | null;
}

export interface RetryInput {
  readonly method: HttpMethod;
  // 1 for the first attempt.
  readonly attempt: number;
  readonly outcome: RequestOutcome;
  readonly nowMs: number;
  readonly random: () => number;
  readonly maxAttempts?: number;
}

export interface RetryDecision {
  readonly retry: boolean;
  readonly delayMs: number;
}

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
const NO_RETRY: RetryDecision = { retry: false, delayMs: 0 };

function retryAfterMs(value: string | null | undefined, nowMs: number): number | undefined {
  if (value === null || value === undefined || value.trim() === "") {
    return undefined;
  }
  const trimmed = value.trim();
  const milliseconds = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - nowMs;
  return Number.isNaN(milliseconds)
    ? undefined
    : Math.min(Math.max(0, milliseconds), MAX_RETRY_AFTER_MS);
}

// Exponential back-off with jitter in [50%, 100%] of the step, capped.
function backoffMs(attempt: number, random: () => number): number {
  const step = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  return Math.min(MAX_BACKOFF_MS, Math.round(step * (0.5 + 0.5 * random())));
}

// Only idempotent reads are retried automatically. A failed write may or may not have
// reached the instance, so repeating it is never safe without checking (ADR-0016).
export function retryDecision(input: RetryInput): RetryDecision {
  const idempotent = input.method === "GET";
  const { status, networkError } = input.outcome;
  const retryable = networkError === true || (status !== undefined && RETRYABLE_STATUS.has(status));
  if (!idempotent || !retryable || input.attempt >= (input.maxAttempts ?? 5)) {
    return NO_RETRY;
  }
  const delayMs =
    retryAfterMs(input.outcome.retryAfter, input.nowMs) ?? backoffMs(input.attempt, input.random);
  return { retry: true, delayMs };
}
