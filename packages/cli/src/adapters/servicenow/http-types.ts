import type { HttpMethod } from "@snagentic/core";

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  // False when the caller retries a timed-out GET itself, with a smaller page (ADR-0053).
  readonly retryTimeout?: boolean;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  // Set by the scheduler: how long the request itself took, from sending it to reading the last
  // byte of its body, without the wait for a slot or the rate limit (PERF2-05).
  readonly elapsedMs?: number;
}

// The transport gave up waiting for an answer (its own timeout, not a cancellation).
export class TransportTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`no answer within ${Math.round(timeoutMs / 1000)} s`);
    this.name = "TransportTimeoutError";
  }
}

export type Transport = (request: HttpRequest, signal: AbortSignal) => Promise<HttpResponse>;

export interface SchedulerClock {
  now(): number;
  random(): number;
  sleep(milliseconds: number, signal: AbortSignal): Promise<void>;
}

export const SYSTEM_CLOCK: SchedulerClock = {
  now: () => Date.now(),
  random: () => Math.random(),
  sleep: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    }),
};
