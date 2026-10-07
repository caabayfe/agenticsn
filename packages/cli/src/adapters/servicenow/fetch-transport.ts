import type { Transport } from "./http-types";

export interface FetchTransportSettings {
  // A single request never takes longer than this (ServiceNow's own transaction quota
  // for REST is typically about a minute).
  readonly timeoutMs?: number;
}

export function fetchTransport(settings: FetchTransportSettings = {}): Transport {
  const timeoutMs = settings.timeoutMs ?? 90_000;
  return async (request, signal) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : { body: request.body }),
      // Basic auth must never follow a redirect to another address; a 3xx is an error.
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    return { status: response.status, headers: response.headers, text: () => response.text() };
  };
}
