import { describe, expect, it } from "bun:test";
import { createProfile, InstanceName } from "@snagentic/core";
import { CicdPluginActivator } from "../../../src/adapters/servicenow/cicd-plugin-activator";
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

function activatorWith(reply: (request: HttpRequest) => ReturnType<Transport>) {
  const sent: HttpRequest[] = [];
  const transport: Transport = async (request) => {
    sent.push(request);
    return reply(request);
  };
  const client = new ServiceNowClient(
    profile,
    "pw",
    new RequestScheduler(transport, { clock: fakeClock() }),
    "snagentic test",
  );
  return { sent, activator: new CicdPluginActivator(client) };
}

const STARTED =
  '{"result":{"links":{"progress":{"id":"a4fae8911bf03050"}},"status":"0","status_label":"Pending","status_message":"","status_detail":"","error":"","percent_complete":0}}';

describe("CicdPluginActivator", () => {
  it("starts an activation with one POST to the CI/CD API", async () => {
    const { activator, sent } = activatorWith(async () => response(200, STARTED));
    expect(await activator.activate("com.snc.cool", LIVE)).toEqual({
      progressId: "a4fae8911bf03050",
      status: "pending",
      percent: 0,
      message: "",
      error: "",
    });
    expect(sent.map((r) => [r.method, new URL(r.url).pathname])).toEqual([
      ["POST", "/api/sn_cicd/plugin/com.snc.cool/activate"],
    ]);
  });

  it("follows progress and reads its states", async () => {
    const { activator, sent } = activatorWith(async () =>
      response(
        200,
        '{"result":{"status":"3","status_message":"Failed","status_detail":"dependency missing","error":"boom","percent_complete":"50"}}',
      ),
    );
    expect(await activator.progress("a4fae8911bf03050", LIVE)).toEqual({
      progressId: "a4fae8911bf03050",
      status: "failed",
      percent: 50,
      message: "Failed: dependency missing",
      error: "boom",
    });
    expect(sent[0]?.method).toBe("GET");
    expect(new URL(sent[0]?.url ?? "").pathname).toBe("/api/sn_cicd/progress/a4fae8911bf03050");
  });

  it("never retries the POST, even on an error a GET would retry", async () => {
    const { activator, sent } = activatorWith(async () =>
      response(504, '{"error":{"message":"gateway timeout"}}'),
    );
    await expect(activator.activate("com.snc.cool", LIVE)).rejects.toMatchObject({
      code: "instance-error",
    });
    expect(sent).toHaveLength(1);
  });

  it("rejects an answer that is not a progress record", async () => {
    const { activator } = activatorWith(async () => response(200, '{"result":{"status":"9"}}'));
    await expect(activator.activate("com.snc.cool", LIVE)).rejects.toMatchObject({
      code: "instance-error",
    });
  });
});
