import { describe, expect, it } from "bun:test";
import { parseServerTiming } from "@snagentic/core";

describe("parseServerTiming", () => {
  it("reads ServiceNow's semaphore and session waits", () => {
    expect(parseServerTiming('t;desc="39e21578c3f7", sem_wait;dur=12, sesh_wait;dur=0')).toEqual({
      sem_wait: 12,
      sesh_wait: 0,
    });
  });

  it("ignores entries without a duration and tolerates a missing header", () => {
    expect(parseServerTiming("cache;desc=hit, db;dur=53.2")).toEqual({ db: 53.2 });
    expect(parseServerTiming(null)).toEqual({});
  });
});
