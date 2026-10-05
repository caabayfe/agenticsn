import { describe, expect, it } from "bun:test";
import { cursorOf, keysetQuery, nextPageSize } from "@snagentic/core";

describe("keysetQuery (ADR-0016)", () => {
  it("orders a snapshot by sys_id and starts after the cursor", () => {
    expect(keysetQuery({ kind: "snapshot", base: "active=true" }, null)).toBe(
      "active=true^ORDERBYsys_id",
    );
    expect(keysetQuery({ kind: "snapshot", base: "active=true" }, { sysId: "abc" })).toBe(
      "active=true^sys_id>abc^ORDERBYsys_id",
    );
  });

  it("starts a change feed at the watermark, ordered by update time then sys_id", () => {
    expect(keysetQuery({ kind: "change-feed", base: "", since: "2026-10-01 00:00:00" }, null)).toBe(
      "sys_updated_on>=2026-10-01 00:00:00^ORDERBYsys_updated_on^ORDERBYsys_id",
    );
  });

  it("continues a change feed past rows sharing the same second, repeating the base in each group", () => {
    expect(
      keysetQuery(
        { kind: "change-feed", base: "sys_class_name=sys_script", since: "2026-10-01 00:00:00" },
        { updatedOn: "2026-10-02 10:00:00", sysId: "abc" },
      ),
    ).toBe(
      "sys_class_name=sys_script^sys_updated_on>2026-10-02 10:00:00" +
        "^NQsys_class_name=sys_script^sys_updated_on=2026-10-02 10:00:00^sys_id>abc" +
        "^ORDERBYsys_updated_on^ORDERBYsys_id",
    );
  });

  it("takes the cursor from the last row of a page", () => {
    const row = { sys_id: "b", sys_updated_on: "2026-10-02 10:00:00" };
    expect(cursorOf("snapshot", row)).toEqual({ sysId: "b" });
    expect(cursorOf("change-feed", row)).toEqual({ sysId: "b", updatedOn: "2026-10-02 10:00:00" });
  });
});

describe("nextPageSize (adaptive, ADR-0016)", () => {
  it("grows toward 1000 while pages are fast", () => {
    expect(nextPageSize(500, { durationMs: 400 })).toBe(750);
    expect(nextPageSize(900, { durationMs: 400 })).toBe(1000);
  });

  it("halves toward 100 when pages are slow or a transaction was cancelled", () => {
    expect(nextPageSize(500, { durationMs: 5000 })).toBe(250);
    expect(nextPageSize(150, { durationMs: 5000 })).toBe(100);
    expect(nextPageSize(800, { durationMs: 10, cancelled: true })).toBe(400);
  });

  it("keeps the size while pages are near the 2 s target", () => {
    expect(nextPageSize(500, { durationMs: 2000 })).toBe(500);
  });
});
