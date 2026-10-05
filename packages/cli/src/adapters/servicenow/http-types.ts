import type { HttpMethod } from "@snagentic/core";

export interface HttpRequest {
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
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
