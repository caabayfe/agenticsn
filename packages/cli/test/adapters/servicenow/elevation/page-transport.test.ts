import { afterAll, describe, expect, it } from "bun:test";
import { sendFromPage } from "../../../../src/adapters/servicenow/elevation/page-scripts";
import { pageTransport } from "../../../../src/adapters/servicenow/elevation/page-transport";

const seen: { method: string; token: string | null; authorization: string | null; body: string }[] =
  [];
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    seen.push({
      method: request.method,
      token: request.headers.get("x-usertoken"),
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    });
    if (new URL(request.url).pathname === "/slow") {
      await Bun.sleep(500);
    }
    return new Response('{"result":{"sys_id":"a1"}}', {
      status: 201,
      headers: { "X-Transaction-ID": "t1", "Content-Type": "application/json" },
    });
  },
});
afterAll(() => server.stop(true));

// Runs the page function here, as the browser does in the signed-in page.
const page = { send: sendFromPage };
const LIVE = new AbortController().signal;

describe("pageTransport (ADR-0024)", () => {
  it("sends each request from the page with its session token, never an Authorization header", async () => {
    const transport = pageTransport(page, "tok123");
    const reply = await transport(
      {
        method: "POST",
        url: `${server.url}api/now/table/sys_security_acl`,
        headers: { Accept: "application/json", Authorization: "Basic leaked" },
        body: '{"name":"incident"}',
      },
      LIVE,
    );
    expect([reply.status, reply.headers.get("x-transaction-id"), await reply.text()]).toEqual([
      201,
      "t1",
      '{"result":{"sys_id":"a1"}}',
    ]);
    expect(seen.at(-1)).toEqual({
      method: "POST",
      token: "tok123",
      authorization: null,
      body: '{"name":"incident"}',
    });
  });

  it("stops waiting when the push is cancelled", async () => {
    const controller = new AbortController();
    const pending = pageTransport(page, "t")(
      { method: "GET", url: `${server.url}slow`, headers: {} },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it("gives up on a request that exceeds the timeout", async () => {
    await expect(
      pageTransport(page, "t", { timeoutMs: 20 })(
        { method: "GET", url: `${server.url}slow`, headers: {} },
        LIVE,
      ),
    ).rejects.toThrow();
  });
});
