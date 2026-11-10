import { describe, expect, it } from "bun:test";
import { createProfile, type InstanceKind, InstanceName, TableName } from "@snagentic/core";
import type { Transport } from "../../../src/adapters/servicenow/http-types";
import {
  environmentLoadSettings,
  InstanceConnections,
} from "../../../src/adapters/servicenow/instance-connections";
import { fakeClock, response } from "./scheduler-fakes";

const LIVE = new AbortController().signal;
const QUERY = {
  table: TableName.parse("sys_script"),
  query: "sys_idISNOTEMPTY",
  fields: ["sys_id"],
  limit: 1,
};

function profileOf(name: string, kind: InstanceKind = "development") {
  return createProfile({
    name: InstanceName.parse(name),
    url: `${name}.service-now.com`,
    username: "svc",
    kind,
    acknowledgeReadOnly: kind !== "development",
  });
}

// Counts requests in flight, per instance host.
function concurrencyProbe() {
  const active = new Map<string, number>();
  const peak = new Map<string, number>();
  const transport: Transport = async (request) => {
    const host = new URL(request.url).host;
    active.set(host, (active.get(host) ?? 0) + 1);
    peak.set(host, Math.max(peak.get(host) ?? 0, active.get(host) ?? 0));
    await new Promise((resolve) => setTimeout(resolve, 5));
    active.set(host, (active.get(host) ?? 1) - 1);
    return response(200, '{"result":[]}');
  };
  return { transport, peak };
}

function connections(transport: Transport, environment: Record<string, string> = {}) {
  return new InstanceConnections({
    transport,
    environment,
    version: "snagentic 1.2.3",
    clock: fakeClock(),
  });
}

describe("InstanceConnections (ADR-0053)", () => {
  it("sends every connection to one instance through one scheduler", async () => {
    const probe = concurrencyProbe();
    const pool = connections(probe.transport);
    const pdi = profileOf("pdi");
    const clients = [pool.open(pdi, "s"), pool.open(pdi, "s"), pool.open(pdi, "s")];
    await Promise.all(
      clients.flatMap((client) => Array.from({ length: 4 }, () => client.query(QUERY, LIVE))),
    );
    expect(probe.peak.get("pdi.service-now.com")).toBe(2);
  });

  it("sends write connections through the instance's one scheduler too", async () => {
    const probe = concurrencyProbe();
    const pool = connections(probe.transport);
    const pdi = { ...profileOf("pdi"), kind: "development" as const };
    const reader = pool.open(pdi, "s");
    const writer = pool.openForWrite(pdi, "s");
    await Promise.all([
      ...Array.from({ length: 4 }, () => reader.query(QUERY, LIVE)),
      ...Array.from({ length: 4 }, () => writer.query(QUERY, LIVE)),
    ]);
    expect(probe.peak.get("pdi.service-now.com")).toBe(2);
    expect(writer.stats().requests).toBe(4);
  });

  it("refuses a write connection to an instance that is not development", () => {
    const pool = connections(async () => response(200, '{"result":[]}'));
    const forged = profileOf("prod", "production") as unknown as Parameters<
      typeof pool.openForWrite
    >[0];
    expect(() => pool.openForWrite(forged, "s")).toThrow(
      expect.objectContaining({ code: "development-instance-required" }),
    );
  });

  it("keeps instances apart", async () => {
    const probe = concurrencyProbe();
    const pool = connections(probe.transport);
    const first = pool.open(profileOf("one"), "s");
    const second = pool.open(profileOf("two"), "s");
    await Promise.all([
      ...Array.from({ length: 4 }, () => first.query(QUERY, LIVE)),
      ...Array.from({ length: 4 }, () => second.query(QUERY, LIVE)),
    ]);
    expect([...probe.peak.values()]).toEqual([2, 2]);
  });

  it("counts each connection's requests on their own", async () => {
    const pool = connections(async () => response(200, '{"result":[]}'));
    const pdi = profileOf("pdi");
    const first = pool.open(pdi, "s");
    const second = pool.open(pdi, "s");
    await first.query(QUERY, LIVE);
    await first.query(QUERY, LIVE);
    await second.query(QUERY, LIVE);
    expect([first.stats().requests, second.stats().requests]).toEqual([2, 1]);
  });

  it("stops a run at the budget instance.yaml sets, and names the variable that raises it", async () => {
    const pool = connections(async () => response(200, '{"result":[]}'));
    const pdi = { ...profileOf("acme-prod", "production"), load: { requestBudget: 1 } };
    const client = pool.open(pdi, "s");
    await client.query(QUERY, LIVE);
    await expect(client.query(QUERY, LIVE)).rejects.toMatchObject({
      code: "request-budget-exhausted",
      hint: expect.stringContaining("SNAGENTIC_ACME_PROD_REQUEST_BUDGET"),
    });
  });

  it("keeps one scheduler for an instance when its limits change while runs are going", async () => {
    const probe = concurrencyProbe();
    const pool = connections(probe.transport);
    const before = pool.open(profileOf("pdi"), "s");
    const after = pool.open({ ...profileOf("pdi"), load: { maxConcurrency: 1 } }, "s");
    await Promise.all([
      ...Array.from({ length: 4 }, () => before.query(QUERY, LIVE)),
      ...Array.from({ length: 4 }, () => after.query(QUERY, LIVE)),
    ]);
    expect(probe.peak.get("pdi.service-now.com")).toBe(1);
  });

  it("lets a later run raise an instance's limits, regained by healthy responses", async () => {
    const probe = concurrencyProbe();
    const pool = connections(probe.transport);
    const lowered = pool.open({ ...profileOf("pdi"), load: { maxConcurrency: 1 } }, "s");
    await lowered.query(QUERY, LIVE);
    const raised = pool.open(profileOf("pdi"), "s");
    for (let healthy = 0; healthy < 20; healthy += 1) await raised.query(QUERY, LIVE);
    await Promise.all(Array.from({ length: 4 }, () => raised.query(QUERY, LIVE)));
    expect(probe.peak.get("pdi.service-now.com")).toBe(2);
  });

  it("lets the environment lower concurrency on an instance", async () => {
    const probe = concurrencyProbe();
    const pool = connections(probe.transport, { SNAGENTIC_PDI_MAX_CONCURRENCY: "1" });
    const client = pool.open(profileOf("pdi"), "s");
    await Promise.all(Array.from({ length: 4 }, () => client.query(QUERY, LIVE)));
    expect(probe.peak.get("pdi.service-now.com")).toBe(1);
  });
});

describe("environmentLoadSettings", () => {
  it("reads the instance's variables, named like its credential variables", () => {
    const settings = environmentLoadSettings(profileOf("acme-prod", "production"), {
      SNAGENTIC_ACME_PROD_MAX_CONCURRENCY: "1",
      SNAGENTIC_ACME_PROD_REQUESTS_PER_SECOND: "3",
      SNAGENTIC_ACME_PROD_REQUEST_BUDGET: "50000",
      SNAGENTIC_OTHER_REQUEST_BUDGET: "7",
    });
    expect(settings).toEqual({ maxConcurrency: 1, requestsPerSecond: 3, requestBudget: 50_000 });
  });

  it.each(["0", "-1", "2.5", "many", "1e3"])(
    "refuses %p as a limit, naming the variable",
    (value) => {
      expect(() =>
        environmentLoadSettings(profileOf("pdi"), { SNAGENTIC_PDI_REQUEST_BUDGET: value }),
      ).toThrow(expect.objectContaining({ code: "invalid-load-limit" }));
    },
  );
});
