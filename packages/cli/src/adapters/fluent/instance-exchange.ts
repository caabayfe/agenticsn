import { SdkRouteRefusedError, sdkRouteAllowed } from "@snagentic/core";

// What the SDK's requests are sent through: snagentic's client, signed and scheduled (ADR-0032).
export type InstanceExchange = (request: {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: string;
}) => Promise<{ readonly status: number; readonly contentType: string; readonly text: string }>;

// `exchange`, sending only reads of the instance at `host` that the SDK is allowed (ADR-0032,
// item 3). The main process wraps the exchange it answers the SDK worker with: the worker's own
// check runs beside the project's code, so it can't be relied on (ADR-0044, item 4).
export function allowedExchange(host: string, exchange: InstanceExchange): InstanceExchange {
  const origin = new URL(host).origin;
  return async (request) => {
    const url = new URL(request.url);
    if (url.origin !== origin) throw new SdkRouteRefusedError(request.method, url.href);
    if (!sdkRouteAllowed(request.method, url.pathname)) {
      throw new SdkRouteRefusedError(request.method, url.pathname);
    }
    return exchange(request);
  };
}
