import { describe, expect, it } from "bun:test";
import {
  createProfile,
  type DevelopmentProfile,
  ensureDevelopmentInstance,
  type InstanceKind,
  InstanceName,
} from "@snagentic/core";
import type { HttpRequest } from "../../../src/adapters/servicenow/http-types";
import { RequestScheduler } from "../../../src/adapters/servicenow/request-scheduler";
import { ServiceNowClient } from "../../../src/adapters/servicenow/servicenow-client";
import { ServiceNowWriteClient } from "../../../src/adapters/servicenow/servicenow-write-client";
import { fakeClock, response } from "./scheduler-fakes";

const LIVE = new AbortController().signal;

function profileOf(kind: InstanceKind) {
  return createProfile({
    name: InstanceName.parse("pdi"),
    url: "dev312411",
    username: "admin",
    kind,
    acknowledgeReadOnly: kind !== "development",
  });
}

function developmentProfile(): DevelopmentProfile {
  const profile = profileOf("development");
  ensureDevelopmentInstance(profile, "test");
  return profile;
}

function readClient(kind: InstanceKind) {
  const sent: HttpRequest[] = [];
  const scheduler = new RequestScheduler(
    async (request) => {
      sent.push(request);
      return response(200, '{"result":{}}');
    },
    { clock: fakeClock() },
  );
  return { sent, client: new ServiceNowClient(profileOf(kind), "s", scheduler, "snagentic 1") };
}

// ADR-0012 layer 3, in the adapter: whatever the caller, nothing that changes a test or
// production instance leaves this process.
describe("ServiceNowClient write gate", () => {
  it("opens a read connection without any write port", () => {
    const { client } = readClient("development");
    for (const port of ["writer", "fluent", "imports", "plugins", "apps"]) {
      expect(port in client).toBe(false);
    }
  });

  it.each(["test", "production"] as const)(
    "refuses a Table API write to a %s instance before sending it",
    async (kind) => {
      const { client, sent } = readClient(kind);
      const write = client.sendJson("POST", "/api/now/table/x", {}, "insert", LIVE);
      await expect(write).rejects.toMatchObject({ code: "development-instance-required" });
      expect(sent).toEqual([]);
    },
  );

  it.each(["test", "production"] as const)(
    "refuses another API's POST to a %s instance before sending it",
    async (kind) => {
      const { client, sent } = readClient(kind);
      const post = client.callApi("POST", "/api/sn_cicd/plugin/x/activate", "activate", LIVE);
      await expect(post).rejects.toMatchObject({ code: "development-instance-required" });
      expect(sent).toEqual([]);
    },
  );

  it("still reads another API of a production instance", async () => {
    const { client, sent } = readClient("production");
    await client.callApi("GET", "/api/sn_cicd/progress/1", "progress", LIVE);
    expect(sent).toHaveLength(1);
  });

  it.each(["test", "production"] as const)(
    "never opens a write connection to a %s instance",
    (kind) => {
      const scheduler = new RequestScheduler(async () => response(200, "{}"), {
        clock: fakeClock(),
      });
      // A forged profile: the type already forbids this, the adapter refuses it all the same.
      const forged = profileOf(kind) as DevelopmentProfile;
      expect(() => new ServiceNowWriteClient(forged, "s", scheduler, "v")).toThrow(
        expect.objectContaining({ code: "development-instance-required" }),
      );
    },
  );

  it("opens a write connection to a development instance with every write port", () => {
    const scheduler = new RequestScheduler(async () => response(200, "{}"), { clock: fakeClock() });
    const client = new ServiceNowWriteClient(developmentProfile(), "s", scheduler, "v");
    expect([
      client.writer,
      client.fluent,
      client.imports,
      client.plugins,
      client.apps,
    ]).toHaveLength(5);
  });
});
