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

// The head of the page a hibernating developer instance answers every request with (status 200),
// as dev402741 sent it on 2026-11-02.
export const HIBERNATING_PAGE = `<html>
    <head>
        <meta HTTP-EQUIV="refresh" content="5;https://developer.servicenow.com/dev.do#!/home?wu=true">
        <title>
            Instance Hibernating page
        </title>
    </head>
    <body>Your instance is hibernating</body>
</html>`;
