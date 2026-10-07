import { describe, expect, it } from "bun:test";
import { createProfile, InstanceName, TableName } from "@snagentic/core";
import { authorize } from "../../../src/adapters/servicenow/authorization";
import type { HttpRequest, HttpResponse } from "../../../src/adapters/servicenow/http-types";
import { RequestScheduler } from "../../../src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../src/adapters/servicenow/servicenow-client";
import { fakeClock, response } from "./scheduler-fakes";

const SECRET = "c1i3nt-S3cret!";
const LIVE = new AbortController().signal;
const TABLE = "https://dev312411.service-now.com/api/now/table/sys_user";
const GET: HttpRequest = { method: "GET", url: TABLE, headers: { Accept: "application/json" } };

const profile = (clientId?: string) =>
  createProfile({
    name: InstanceName.parse("pdi"),
    url: "dev312411",
    username: "svc_oauth",
    ...(clientId === undefined ? {} : { clientId }),
    kind: "development",
    acknowledgeReadOnly: false,
  });

const token = (value: string, expiresIn: number | string = 1799) =>
  response(
    200,
    JSON.stringify({ access_token: value, token_type: "Bearer", expires_in: expiresIn }),
  );

// An instance that issues tok1, tok2, ... and accepts only the latest one, unless told otherwise.
function instance(
  options: { tokenReply?: () => HttpResponse; accept?: (auth: string) => boolean } = {},
) {
  const sent: HttpRequest[] = [];
  let issued = 0;
  const clock = { ...fakeClock(), at: Date.parse("2026-10-07T12:00:00Z") };
  clock.now = () => clock.at;
  const transport = async (request: HttpRequest) => {
    sent.push(request);
    if (request.url.endsWith("/oauth_token.do")) {
      issued += 1;
      return options.tokenReply?.() ?? token(`tok${issued}`);
    }
    const auth = request.headers["Authorization"] ?? "";
    const accepted = options.accept?.(auth) ?? auth === `Bearer tok${issued}`;
    return accepted ? response(200, '{"result":[]}') : response(401, "{}");
  };
  const scheduler = new RequestScheduler(transport, { clock });
  const tokens = () => sent.filter((request) => request.url.endsWith("/oauth_token.do"));
  return { sent, clock, scheduler, tokens };
}

describe("OAuth client credentials (ADR-0021)", () => {
  it("gets one token with the client credentials and sends it as a bearer token", async () => {
    const { scheduler, sent, tokens } = instance();
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    await sender.send(GET, LIVE);
    await sender.send(GET, LIVE);
    expect(tokens()).toHaveLength(1);
    const request = tokens()[0];
    expect(request).toMatchObject({
      method: "POST",
      url: "https://dev312411.service-now.com/oauth_token.do",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expect(Object.fromEntries(new URLSearchParams(request?.body))).toEqual({
      grant_type: "client_credentials",
      client_id: "0123abcd",
      client_secret: SECRET,
    });
    const calls = sent.filter((r) => r.url === TABLE);
    expect(calls.map((r) => r.headers["Authorization"])).toEqual(["Bearer tok1", "Bearer tok1"]);
  });

  it("shares one token request between requests made at the same time", async () => {
    const { scheduler, tokens } = instance();
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    await Promise.all([sender.send(GET, LIVE), sender.send(GET, LIVE), sender.send(GET, LIVE)]);
    expect(tokens()).toHaveLength(1);
  });

  it("renews the token a minute before it expires", async () => {
    const { scheduler, clock, tokens } = instance();
    const sender = authorize(profile("0123abcd"), SECRET, scheduler, clock);
    await sender.send(GET, LIVE);
    clock.at += 1799_000 - 61_000;
    await sender.send(GET, LIVE);
    expect(tokens()).toHaveLength(1);
    clock.at += 2_000;
    await sender.send(GET, LIVE);
    expect(tokens()).toHaveLength(2);
  });

  it("asks for a new token once when the instance rejects the current one, and retries", async () => {
    let first = true;
    const { scheduler, sent, tokens } = instance({
      accept: (auth) => {
        const ok = !(first && auth === "Bearer tok1");
        first = false;
        return ok;
      },
    });
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    expect((await sender.send(GET, LIVE)).status).toBe(200);
    expect(tokens()).toHaveLength(2);
    expect(sent.at(-1)?.headers["Authorization"]).toBe("Bearer tok2");
  });

  it("returns the second rejection instead of asking again", async () => {
    const { scheduler, tokens } = instance({ accept: () => false });
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    expect((await sender.send(GET, LIVE)).status).toBe(401);
    expect(tokens()).toHaveLength(2);
  });

  it.each([
    [400, '{"error":"invalid_client","error_description":"bad"}'],
    [401, '{"error":"access_denied"}'],
  ])("reports a rejected client (%p) without the secret", async (status, body) => {
    const { scheduler } = instance({ tokenReply: () => response(status, body) });
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    const error = await sender.send(GET, LIVE).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "authentication-failed" });
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(String(error)).not.toContain(SECRET);
  });

  it("explains when the instance does not allow the client-credentials grant", async () => {
    const { scheduler } = instance({
      tokenReply: () => response(400, '{"error":"unsupported_grant_type"}'),
    });
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    await expect(sender.send(GET, LIVE)).rejects.toMatchObject({
      code: "oauth-grant-unavailable",
      hint: expect.stringContaining("glide.oauth.inbound.client.credential.grant_type.enabled"),
    });
  });

  it.each([
    ["an HTML page", response(200, "<html>hibernating</html>")],
    ["no access token", response(200, '{"token_type":"Bearer"}')],
    ["a server error", response(500, `{"echo":"${SECRET}"}`)],
  ])("refuses a token response with %s, without repeating it", async (_what, reply) => {
    const { scheduler } = instance({ tokenReply: () => reply });
    const sender = authorize(profile("0123abcd"), SECRET, scheduler);
    const error = await sender.send(GET, LIVE).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "instance-error" });
    expect(String(error)).not.toContain(SECRET);
  });

  it("signs Basic profiles with the user and password, and never asks for a token", async () => {
    const { scheduler, sent } = instance({ accept: () => true });
    await authorize(profile(), SECRET, scheduler).send(GET, LIVE);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers["Authorization"]).toBe(`Basic ${btoa(`svc_oauth:${SECRET}`)}`);
  });

  it("is what ServiceNowClient uses for an OAuth profile", async () => {
    const { scheduler, sent } = instance();
    const client = new ServiceNowClient(profile("0123abcd"), SECRET, scheduler, "snagentic 1.2.0");
    const query = { table: TableName.parse("sys_user"), query: "", fields: ["sys_id"], limit: 1 };
    await client.query(query, LIVE);
    expect(sent.map((request) => new URL(request.url).pathname)).toEqual([
      "/oauth_token.do",
      "/api/now/table/sys_user",
    ]);
    expect(sent[1]?.headers["Authorization"]).toBe("Bearer tok1");
    expect(sent[1]?.headers["User-Agent"]).toContain("snagentic 1.2.0");
  });
});
