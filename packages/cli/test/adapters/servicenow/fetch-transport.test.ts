import { afterAll, describe, expect, it } from "bun:test";
import { fetchTransport } from "../../../src/adapters/servicenow/fetch-transport";

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
afterAll(() => server.stop(true));

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
});
