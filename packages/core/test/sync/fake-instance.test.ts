import { describe, expect, it } from "bun:test";
import { keysetQuery } from "@snagentic/core";
import { evaluate } from "../support/fake-instance";

const rows = [
  { sys_id: "c", sys_updated_on: "2026-10-05 10:00:00", flow: "f1" },
  { sys_id: "a", sys_updated_on: "2026-10-05 10:00:00", flow: "f2" },
  { sys_id: "b", sys_updated_on: "2026-10-05 09:00:00", flow: "f1" },
];

describe("the fake instance's query evaluation", () => {
  it("follows a change feed's keyset pages like the instance", () => {
    const filter = { kind: "change-feed" as const, base: "", since: "2026-10-05 09:30:00" };
    const first = evaluate(rows, keysetQuery(filter, null), 1);
    expect(first.map((row) => row["sys_id"])).toEqual(["a"]);
    const next = keysetQuery(filter, { sysId: "a", updatedOn: "2026-10-05 10:00:00" });
    expect(evaluate(rows, next, 10).map((row) => row["sys_id"])).toEqual(["c"]);
  });

  it("filters with IN lists and orders by sys_id", () => {
    const query = keysetQuery({ kind: "snapshot", base: "flowINf1,f3" }, null);
    expect(evaluate(rows, query, 10).map((row) => row["sys_id"])).toEqual(["b", "c"]);
  });
});
