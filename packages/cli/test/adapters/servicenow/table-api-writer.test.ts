import { describe, expect, it } from "bun:test";
import { createProfile, InstanceName } from "@snagentic/core";
import type { HttpRequest, Transport } from "../../../src/adapters/servicenow/http-types";
import { RequestScheduler } from "../../../src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../src/adapters/servicenow/servicenow-client";
import { fakeClock, response } from "./scheduler-fakes";

const LIVE = new AbortController().signal;
const profile = createProfile({
  name: InstanceName.parse("pdi"),
  url: "dev312411",
  username: "admin",
  kind: "development",
  acknowledgeReadOnly: false,
});

function writerWith(reply: (request: HttpRequest) => ReturnType<Transport>) {
  const sent: HttpRequest[] = [];
  const transport: Transport = async (request) => {
    sent.push(request);
    return reply(request);
  };
  const client = new ServiceNowClient(
    profile,
    "secret",
    new RequestScheduler(transport, { clock: fakeClock() }),
    "v",
  );
  return { sent, writer: client.writer };
}

describe("TableApiWriter", () => {
  it("creates with POST and updates with PATCH, raw values in, only the identity back", async () => {
    const { writer, sent } = writerWith(async () =>
      response(201, '{"result":{"sys_id":"abc","sys_updated_on":"2026-10-06 10:00:00"}}'),
    );
    expect(await writer.insert("sys_update_set", { name: "snagentic: b [global]" }, LIVE)).toEqual({
      sys_id: "abc",
      sys_updated_on: "2026-10-06 10:00:00",
    });
    await writer.update("sys_script", "abc", { order: "200" }, LIVE);
    expect(sent.map((r) => [r.method, new URL(r.url).pathname, r.body])).toEqual([
      ["POST", "/api/now/table/sys_update_set", '{"name":"snagentic: b [global]"}'],
      ["PATCH", "/api/now/table/sys_script/abc", '{"order":"200"}'],
    ]);
    expect(Object.fromEntries(new URL(sent[0]?.url ?? "").searchParams)).toEqual({
      sysparm_input_display_value: "false",
      sysparm_fields: "sys_id,sys_updated_on",
    });
    expect(sent[0]?.headers["Content-Type"]).toBe("application/json");
  });

  it("never retries a write: an unclear outcome fails at once", async () => {
    const { writer, sent } = writerWith(async () => response(503, "{}"));
    await expect(writer.update("sys_script", "abc", { order: "1" }, LIVE)).rejects.toThrow(
      /HTTP 503/,
    );
    expect(sent).toHaveLength(1);
  });

  it("refuses an answer that is not a record", async () => {
    const { writer } = writerWith(async () => response(200, '{"result":null}'));
    await expect(writer.insert("x", {}, LIVE)).rejects.toThrow(/not a record/);
  });
});
