import type {
  HttpRequest,
  HttpResponse,
  SchedulerClock,
} from "../../../src/adapters/servicenow/http-types";

export function response(
  status: number,
  body = "{}",
  headers: Record<string, string> = {},
): HttpResponse {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: async () => body,
  };
}

// A clock whose sleeps resolve immediately but are recorded.
export function fakeClock(): SchedulerClock & { slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    now: () => Date.parse("2026-10-05T12:00:00Z"),
    random: () => 1,
    sleep: async (ms, signal) => {
      slept.push(ms);
      if (signal.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
    },
  };
}

export const GET: HttpRequest = { method: "GET", url: "https://x/api/now/table/t", headers: {} };
