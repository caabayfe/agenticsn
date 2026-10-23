import { Connector, LazyCredential } from "@servicenow/sdk-api";
import { SdkRouteRefusedError, sdkRouteAllowed } from "@snagentic/core";
import type { InstanceExchange } from "./instance-exchange";

export type { InstanceExchange } from "./instance-exchange";

// The SDK's connector with its one way out replaced: every request is checked against the read
// allow-list and sent through `exchange`. The SDK is never given a credential: its higher-level
// calls (unloadDependentRecords and the rest) all end in fetch.
export class SchedulerConnector extends Connector {
  constructor(
    host: string,
    private readonly exchange: InstanceExchange,
  ) {
    // The SDK holds the host and nothing to sign in with: asked for a credential, it is refused.
    super(
      new LazyCredential(new URL(host), () => {
        throw new SdkRouteRefusedError("AUTH", "a credential for the SDK");
      }),
    );
  }

  override async fetch(
    path: string,
    init?: RequestInit,
    params?: URLSearchParams,
  ): Promise<Response> {
    const url = new URL(path, this.getHost());
    if (params !== undefined) url.search = params.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    // An absolute URL resolves to its own host: only the instance's origin may be read.
    if (url.origin !== this.getHost().origin) {
      throw new SdkRouteRefusedError(method, url.href);
    }
    if (!sdkRouteAllowed(method, url.pathname) || (method !== "GET" && method !== "POST")) {
      throw new SdkRouteRefusedError(method, url.pathname);
    }
    const body = typeof init?.body === "string" ? { body: init.body } : {};
    const answer = await this.exchange({ method, url: url.href, ...body });
    return new Response(answer.text, {
      status: answer.status,
      headers: { "content-type": answer.contentType },
    });
  }
}
