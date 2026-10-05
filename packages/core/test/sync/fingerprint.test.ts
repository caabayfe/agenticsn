import { describe, expect, it } from "bun:test";
import {
  CHILD_TABLES,
  changesSince,
  compareFingerprint,
  FINGERPRINT_SOURCES,
} from "@snagentic/core";

const BASE = { count: 100, maxUpdatedOn: "2026-10-05 10:00:00" };

describe("compareFingerprint", () => {
  it("sees no change when count and latest update are equal", () => {
    expect(compareFingerprint(BASE, { ...BASE })).toBe("unchanged");
  });

  it("sees an insert or update as changed", () => {
    expect(compareFingerprint(BASE, { count: 101, maxUpdatedOn: "2026-10-05 10:05:00" })).toBe(
      "changed",
    );
    expect(compareFingerprint(BASE, { count: 100, maxUpdatedOn: "2026-10-05 10:05:00" })).toBe(
      "changed",
    );
  });

  it("sees a lower count as shrunk, so deletions are found even when timestamps did not move", () => {
    expect(compareFingerprint(BASE, { count: 99, maxUpdatedOn: BASE.maxUpdatedOn })).toBe("shrunk");
  });

  it("treats a source without a previous fingerprint as changed", () => {
    expect(compareFingerprint(undefined, BASE)).toBe("changed");
  });
});

describe("fingerprint sources", () => {
  it("are sys_metadata plus every child table", () => {
    expect(FINGERPRINT_SOURCES).toEqual([
      "sys_metadata",
      ...CHILD_TABLES.map((child) => child.table),
    ]);
  });
});

describe("changesSince", () => {
  it("starts ten minutes before the watermark, across midnight too", () => {
    expect(changesSince("2026-10-05 12:00:00")).toBe("2026-10-05 11:50:00");
    expect(changesSince("2026-01-01 00:05:00")).toBe("2025-12-31 23:55:00");
  });

  it("rejects a watermark that is not a raw UTC timestamp", () => {
    expect(() => changesSince("yesterday")).toThrow(/raw UTC/);
  });
});
