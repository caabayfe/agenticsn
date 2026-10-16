import { Connector } from "@servicenow/sdk-api";
import { SdkRouteRefusedError, sdkRouteAllowed } from "@snagentic/core";

// What the SDK's requests are sent through: snagentic's client, signed and scheduled (ADR-0032).
export type InstanceExchange = (request: {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly body?: string;
}) => Promise<{ readonly status: number; readonly contentType: string; readonly text: string }>;

// The SDK's connector with its one way out replaced: every request is checked against the read
// allow-list and sent through `exchange`. The SDK is never given a credential: its higher-level
// calls (unloadDependentRecords and the rest) all end in fetch.
export class SchedulerConnector extends Connector {
  constructor(
    private readonly host: string,
    private readonly exchange: InstanceExchange,
  ) {
    // The SDK wraps this credential, and the connector never reaches it: fetch and getHost are
    // replaced.
    super({ getUrl: () => host } as unknown as ConstructorParameters<typeof Connector>[0]);
  }

  override getHost(): URL {
    return new URL(this.host);
  }

  override async fetch(
    path: string,
    init?: RequestInit,
    params?: URLSearchParams,
  ): Promise<Response> {
    const url = new URL(path, this.getHost());
    if (params !== undefined) url.search = params.toString();
    const method = (init?.method ?? "GET").toUpperCase();
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
