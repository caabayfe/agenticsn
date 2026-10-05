import { describe, expect, it } from "bun:test";
import { retryDecision } from "@snagentic/core";

const base = { method: "GET" as const, attempt: 1, random: () => 0.5, nowMs: 0 };

describe("retryDecision", () => {
  it.each([429, 502, 503, 504])("retries an idempotent read after HTTP %p", (status) => {
    expect(retryDecision({ ...base, outcome: { status } }).retry).toBe(true);
  });

  it.each([400, 401, 403, 404, 500])("does not retry HTTP %p", (status) => {
    expect(retryDecision({ ...base, outcome: { status } }).retry).toBe(false);
  });

  it("retries an idempotent read after a network error", () => {
    expect(retryDecision({ ...base, outcome: { networkError: true } }).retry).toBe(true);
  });

  it("never retries a write automatically, whatever happened", () => {
    for (const outcome of [{ status: 503 }, { status: 429 }, { networkError: true }]) {
      expect(retryDecision({ ...base, method: "POST", outcome }).retry).toBe(false);
    }
  });

  it("honors Retry-After in seconds, capped at 60 s", () => {
    expect(retryDecision({ ...base, outcome: { status: 429, retryAfter: "7" } }).delayMs).toBe(
      7000,
    );
    expect(retryDecision({ ...base, outcome: { status: 429, retryAfter: "3600" } }).delayMs).toBe(
      60000,
    );
  });

  it("honors Retry-After as an HTTP date", () => {
    const nowMs = Date.parse("2026-10-05T12:00:00Z");
    const retryAfter = "Mon, 05 Oct 2026 12:00:12 GMT";
    expect(retryDecision({ ...base, nowMs, outcome: { status: 503, retryAfter } }).delayMs).toBe(
      12000,
    );
  });

  it("backs off exponentially with jitter, capped at 30 s", () => {
    const delays = [1, 2, 3, 4, 10].map(
      (attempt) =>
        retryDecision({
          ...base,
          attempt,
          maxAttempts: 20,
          random: () => 1,
          outcome: { status: 503 },
        }).delayMs,
    );
    expect(delays).toEqual([1000, 2000, 4000, 8000, 30000]);
    expect(retryDecision({ ...base, random: () => 0, outcome: { status: 503 } }).delayMs).toBe(500);
  });

  it("gives up after the maximum number of attempts", () => {
    expect(retryDecision({ ...base, attempt: 5, outcome: { status: 503 } }).retry).toBe(false);
  });
});
