import { describe, expect, it } from "bun:test";
import { createProfile, InstanceName, TableName } from "@snagentic/core";
import type { HttpRequest, Transport } from "../../../src/adapters/servicenow/http-types";
import { RequestScheduler } from "../../../src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../src/adapters/servicenow/servicenow-client";
import { fakeClock, response } from "./scheduler-fakes";

const SECRET = "Jv!k0F1kC*Ch";
const LIVE = new AbortController().signal;
const profile = createProfile({
  name: InstanceName.parse("pdi"),
  url: "dev312411",
  username: "admin",
  kind: "development",
  acknowledgeReadOnly: false,
});

function clientWith(reply: (request: HttpRequest) => ReturnType<Transport>) {
  const sent: HttpRequest[] = [];
  const transport: Transport = async (request) => {
    sent.push(request);
    return reply(request);
  };
  const scheduler = new RequestScheduler(transport, { clock: fakeClock() });
  return { sent, client: new ServiceNowClient(profile, SECRET, scheduler, "snagentic 1.2.3") };
}

const QUERY = {
  table: TableName.parse("sys_script"),
  query: "sys_updated_on>=2026-10-01 00:00:00",
  fields: ["sys_id", "sys_updated_on"],
  limit: 500,
};

describe("ServiceNowClient", () => {
  it("asks only for the named fields, raw values, no reference links and no row count", async () => {
    const { client, sent } = clientWith(async () => response(200, '{"result":[{"sys_id":"a"}]}'));
    expect(await client.query(QUERY, LIVE)).toEqual([{ sys_id: "a" }]);
    const url = new URL(sent[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe(
      "https://dev312411.service-now.com/api/now/table/sys_script",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sysparm_query: QUERY.query,
      sysparm_fields: "sys_id,sys_updated_on",
      sysparm_limit: "500",
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
      sysparm_no_count: "true",
    });
  });

  it("reports the scheduler's connection statistics", async () => {
    const { client } = clientWith(async () =>
      response(200, '{"result":[]}', {
        "X-Transaction-ID": "tx1",
        "Server-Timing": "sem_wait;dur=2",
      }),
    );
    await client.query(QUERY, LIVE);
    expect(client.stats()).toMatchObject({
      requests: 1,
      semaphoreWaitMs: 2,
      transactionIds: ["tx1"],
    });
  });

  it("downloads whole records without a field list when asked for all fields", async () => {
    const { client, sent } = clientWith(async () => response(200, '{"result":[]}'));
    await client.query({ ...QUERY, fields: "all" }, LIVE);
    expect(new URL(sent[0]?.url ?? "").searchParams.has("sysparm_fields")).toBe(false);
  });

  it("authenticates with basic auth and identifies itself", async () => {
    const { client, sent } = clientWith(async () => response(200, '{"result":[]}'));
    await client.query(QUERY, LIVE);
    expect(sent[0]?.headers).toMatchObject({
      Authorization: `Basic ${btoa(`admin:${SECRET}`)}`,
      Accept: "application/json",
      "User-Agent": "snagentic 1.2.3",
    });
  });

  it.each([[[]], [["sys_id", ""]]])(
    "refuses a query without explicit fields (%p)",
    async (fields) => {
      const { client } = clientWith(async () => response(200));
      await expect(client.query({ ...QUERY, fields }, LIVE)).rejects.toThrow(/fields/);
    },
  );

  it.each([0, 10001])("refuses a page size of %p", async (limit) => {
    const { client } = clientWith(async () => response(200));
    await expect(client.query({ ...QUERY, limit }, LIVE)).rejects.toThrow(/limit/);
  });

  it("explains a rejected password without revealing it", async () => {
    const { client } = clientWith(async () =>
      response(401, '{"error":{"message":"User Not Authenticated"}}'),
    );
    const error = await client.query(QUERY, LIVE).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "authentication-failed",
      hint: "run: snagentic auth login pdi",
    });
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it("reports missing read access to a table as not permitted", async () => {
    const { client } = clientWith(async () =>
      response(403, '{"error":{"message":"Insufficient rights to query records"}}'),
    );
    await expect(client.query(QUERY, LIVE)).rejects.toMatchObject({
      code: "access-denied",
      category: "not-permitted",
      message: expect.stringContaining("sys_script"),
    });
  });

  it("reports other instance errors with the status and transaction id", async () => {
    const { client } = clientWith(async () =>
      response(500, '{"error":{"message":"boom"}}', { "X-Transaction-ID": "abc123" }),
    );
    await expect(client.query(QUERY, LIVE)).rejects.toMatchObject({
      code: "instance-error",
      category: "remote",
      message: expect.stringMatching(/500.*boom.*abc123/),
    });
  });

  it("reports a response that is not the expected JSON", async () => {
    const { client } = clientWith(async () => response(200, "<html>hibernating</html>"));
    await expect(client.query(QUERY, LIVE)).rejects.toMatchObject({ code: "instance-error" });
  });
});
