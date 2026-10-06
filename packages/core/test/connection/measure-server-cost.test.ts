import { describe, expect, it } from "bun:test";
import { AccessDeniedError, measureServerCost, OperationCancelledError } from "@snagentic/core";

const COST = {
  transactions: 3,
  responseMs: 575,
  maxResponseMs: 367,
  sqlMs: 182,
  sqlQueries: 87,
  cpuMs: 41,
  businessRuleMs: 0,
  aclMs: 22,
  semaphoreWaitMs: 2,
};
const LIVE = new AbortController().signal;

describe("measureServerCost", () => {
  it("returns what the transaction log recorded", async () => {
    expect(
      await measureServerCost({ serverCost: async () => COST }, "2026-10-06 10:00:00", LIVE),
    ).toEqual(COST);
  });

  it("is unavailable, not a failure, when the log cannot be read", async () => {
    const denied = {
      serverCost: async () => {
        throw new AccessDeniedError("table syslog_transaction", "Insufficient rights");
      },
    };
    expect(await measureServerCost(denied, "2026-10-06 10:00:00", LIVE)).toBeNull();
  });

  it("still stops when cancelled", async () => {
    const cancelled = {
      serverCost: async () => {
        throw new OperationCancelledError();
      },
    };
    await expect(measureServerCost(cancelled, "2026-10-06 10:00:00", LIVE)).rejects.toBeInstanceOf(
      OperationCancelledError,
    );
  });
});
