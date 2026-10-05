import { describe, expect, it } from "bun:test";
import {
  AuthenticationFailedError,
  type Check,
  type ConnectionStats,
  createProfile,
  InstanceName,
  type InstanceReader,
  InstanceUnreachableError,
  type Row,
  runInstanceChecks,
  type TableQuery,
} from "@snagentic/core";

const LIVE = new AbortController().signal;
const STATS: ConnectionStats = {
  requests: 3,
  retries: 0,
  semaphoreWaitMs: 4,
  transactionIds: [],
  concurrencyLimit: 2,
  peakConcurrency: 2,
  requestMs: 0,
};

function profile(kind: "development" | "production" = "development") {
  return createProfile({
    name: InstanceName.parse("pdi"),
    url: "dev312411",
    username: "admin",
    kind,
    acknowledgeReadOnly: kind !== "development",
  });
}

// Answers by table; a table mapped to an Error throws it.
function reader(
  answers: Record<string, readonly Row[] | Error>,
): InstanceReader & { queries: TableQuery[] } {
  const queries: TableQuery[] = [];
  return {
    queries,
    query: async (query) => {
      queries.push(query);
      const isProbe = query.table === "sys_user" && query.query.includes("sys_updated_on=");
      const answer = answers[isProbe ? "probe" : query.table] ?? [];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    stats: () => STATS,
  };
}

const USER = { sys_id: "u1", user_name: "admin", sys_updated_on: "2026-09-23 20:12:26" };
const HEALTHY = { sys_user: [USER], sys_user_has_role: [{ "role.name": "admin" }], probe: [USER] };

function byName(checks: readonly Check[]): Record<string, Check> {
  return Object.fromEntries(checks.map((check) => [check.name, check]));
}

describe("runInstanceChecks", () => {
  it("passes every check for a healthy instance and an admin user", async () => {
    const checks = byName(await runInstanceChecks(profile(), "pw", reader(HEALTHY), LIVE));
    expect(Object.keys(checks)).toEqual([
      "credentials",
      "connection",
      "roles",
      "timestamps",
      "load",
    ]);
    expect(Object.values(checks).map((check) => check.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok",
      "ok",
    ]);
    expect(checks["load"]?.detail).toBe("3 requests, semaphore wait 4 ms, concurrency 2");
  });

  it("fails on missing credentials and skips the rest without contacting the instance", async () => {
    const fake = reader(HEALTHY);
    const checks = await runInstanceChecks(profile(), null, fake, LIVE);
    expect(checks.map((check) => check.status)).toEqual([
      "fail",
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
    expect(checks[0]?.hint).toContain("snagentic auth login pdi");
    expect(fake.queries).toEqual([]);
  });

  it.each([
    [new AuthenticationFailedError("pdi"), "snagentic auth login pdi"],
    [
      new InstanceUnreachableError("https://dev312411.service-now.com", "fetch failed"),
      "hibernate",
    ],
  ])("fails the connection check with the error's hint (%p)", async (error, hint) => {
    const checks = byName(
      await runInstanceChecks(profile(), "pw", reader({ sys_user: error }), LIVE),
    );
    expect(checks["connection"]).toMatchObject({
      status: "fail",
      hint: expect.stringContaining(hint),
    });
    expect(checks["roles"]?.status).toBe("unavailable");
  });

  it("warns when the user is not an admin", async () => {
    const answers = { ...HEALTHY, sys_user_has_role: [{ "role.name": "snc_read_only" }] };
    const checks = byName(await runInstanceChecks(profile(), "pw", reader(answers), LIVE));
    expect(checks["roles"]).toMatchObject({ status: "warn", detail: "has snc_read_only" });
  });

  it("asks only about the roles that matter, so long role lists cannot be truncated", async () => {
    const fake = reader(HEALTHY);
    await runInstanceChecks(profile(), "pw", fake, LIVE);
    expect(fake.queries[1]?.query).toBe("user=u1^state=active^role.nameINadmin,snc_read_only");
  });

  it("says so when the user has neither role", async () => {
    const empty = { ...HEALTHY, sys_user_has_role: [] };
    const checks = byName(await runInstanceChecks(profile(), "pw", reader(empty), LIVE));
    expect(checks["roles"]?.detail).toBe("has neither admin nor snc_read_only");
  });

  it("warns when a production credential lacks snc_read_only", async () => {
    const checks = byName(
      await runInstanceChecks(profile("production"), "pw", reader(HEALTHY), LIVE),
    );
    expect(checks["roles"]).toMatchObject({
      status: "warn",
      hint: expect.stringContaining("snc_read_only"),
    });
  });

  it("fails when the instance does not read query timestamps as UTC", async () => {
    const checks = byName(
      await runInstanceChecks(profile(), "pw", reader({ ...HEALTHY, probe: [] }), LIVE),
    );
    expect(checks["timestamps"]).toMatchObject({
      status: "fail",
      hint: expect.stringContaining("incremental"),
    });
  });

  it("names only indexed fields and never asks for more than it needs", async () => {
    const fake = reader(HEALTHY);
    await runInstanceChecks(profile(), "pw", fake, LIVE);
    expect(fake.queries.map((query) => [String(query.table), query.limit])).toEqual([
      ["sys_user", 1],
      ["sys_user_has_role", 10],
      ["sys_user", 1],
    ]);
    expect(fake.queries.every((query) => query.fields.length > 0)).toBe(true);
  });
});
