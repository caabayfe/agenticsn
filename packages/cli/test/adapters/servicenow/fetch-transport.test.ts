import { afterAll, describe, expect, it } from "bun:test";
import { fetchTransport } from "../../../src/adapters/servicenow/fetch-transport";
import { TransportTimeoutError } from "../../../src/adapters/servicenow/http-types";
import { untrustedServer, withTlsChecksOff } from "../../support/untrusted-tls";

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/moved") {
      return Response.redirect("/ok", 302);
    }
    if (new URL(request.url).pathname === "/slow") {
      await Bun.sleep(200);
    }
    return new Response(`${request.method} ${request.headers.get("x-test")}`, {
      status: 201,
      headers: { "X-Transaction-ID": "t1" },
    });
  },
});
const untrusted = untrustedServer();
afterAll(() => {
  server.stop(true);
  untrusted.stop(true);
});

const LIVE = new AbortController().signal;

describe("fetchTransport", () => {
  it("sends the method and headers and returns status, headers and body", async () => {
    const transport = fetchTransport();
    const reply = await transport(
      { method: "GET", url: `${server.url}ok`, headers: { "x-test": "yes" } },
      LIVE,
    );
    expect([reply.status, reply.headers.get("x-transaction-id"), await reply.text()]).toEqual([
      201,
      "t1",
      "GET yes",
    ]);
  });

  it("never follows a redirect, so credentials are not sent to another address", async () => {
    const reply = await fetchTransport()(
      { method: "GET", url: `${server.url}moved`, headers: { "x-test": "yes" } },
      LIVE,
    );
    expect(reply.status).toBe(302);
  });

  it("gives up on a request that exceeds the timeout", async () => {
    const transport = fetchTransport({ timeoutMs: 20 });
    await expect(
      transport({ method: "GET", url: `${server.url}slow`, headers: {} }, LIVE),
    ).rejects.toThrow();
  });

  it("reports its own timeout as a timeout, so the scheduler can treat it as pressure", async () => {
    const transport = fetchTransport({ timeoutMs: 20 });
    const failure = await transport(
      { method: "GET", url: `${server.url}slow`, headers: {} },
      LIVE,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TransportTimeoutError);
  });

  it("reports a cancellation as a cancellation, not a timeout", async () => {
    const cancellation = new AbortController();
    const pending = fetchTransport()(
      { method: "GET", url: `${server.url}slow`, headers: {} },
      cancellation.signal,
    ).catch((error: unknown) => error);
    cancellation.abort();
    expect(await pending).not.toBeInstanceOf(TransportTimeoutError);
  });

  it("checks the certificate even when the environment turns checking off", async () => {
    await withTlsChecksOff(() =>
      expect(
        fetchTransport()({ method: "GET", url: `${untrusted.url}`, headers: {} }, LIVE),
      ).rejects.toThrow(),
    );
  });
});

// A corporate proxy is set by the person in their own environment (docs/guides/network.md). This
// one only records the tunnel it is asked for and refuses it.
async function throughProxy(env: Record<string, string>, body: () => Promise<unknown>) {
  const tunnels: string[] = [];
  const proxy = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        tunnels.push(data.toString().split("\r\n")[0] ?? "");
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      },
    },
  });
  const names = ["HTTPS_PROXY", "NO_PROXY", ...Object.keys(env)];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  Object.assign(process.env, { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`, ...env });
  try {
    await body().catch(() => undefined);
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    proxy.stop(true);
  }
  return tunnels;
}

describe("fetchTransport behind a proxy", () => {
  const request = () =>
    fetchTransport()({ method: "GET", url: `${untrusted.url}ok`, headers: {} }, LIVE);

  it("tunnels instance traffic through the proxy in the environment", async () => {
    const tunnels = await throughProxy({}, request);
    expect(tunnels).toEqual([`CONNECT localhost:${untrusted.port} HTTP/1.1`]);
  });

  it("goes direct to hosts listed in NO_PROXY", async () => {
    expect(await throughProxy({ NO_PROXY: "localhost" }, request)).toEqual([]);
  });
});
