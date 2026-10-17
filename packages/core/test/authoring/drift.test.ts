import { describe, expect, it } from "bun:test";
import { driftedUnits, EMPTY_LEDGER, withEntries } from "@snagentic/core";

const entry = (instance: string) => ({ build: "b", instance, losses: [] });
const ledger = withEntries(
  EMPTY_LEDGER,
  "pdi2",
  new Map([
    ["sys_script_include_a", entry("1|2026-10-16 06:30:48")],
    ["sys_ui_list_x_t_null", entry("2|2026-10-16 07:00:00|rows:3:0123456789abcdef")],
  ]),
);

describe("driftedUnits (ADR-0033)", () => {
  it("names adopted units a pull shows changed since they agreed with source", () => {
    const pulled = [
      { updateName: "sys_script_include_a", modCount: "2", updatedOn: "2026-10-16 09:00:00" },
      { updateName: "sys_ui_list_x_t_null", modCount: "3", updatedOn: "2026-10-16 09:00:00" },
    ];
    expect(driftedUnits(pulled, [ledger], "pdi2")).toEqual([
      "sys_script_include_a",
      "sys_ui_list_x_t_null",
    ]);
  });

  it("does not name this branch's own push coming back, records never adopted, or other instances", () => {
    const pulled = [
      { updateName: "sys_script_include_a", modCount: "1", updatedOn: "2026-10-16 06:30:48" },
      { updateName: "sys_ui_list_x_t_null", modCount: "2", updatedOn: "2026-10-16 07:00:00" },
      { updateName: "sys_properties_b", modCount: "9", updatedOn: "2026-10-16 09:00:00" },
    ];
    expect(driftedUnits(pulled, [ledger], "pdi2")).toEqual([]);
    expect(
      driftedUnits([{ ...pulled[0], modCount: "5" } as (typeof pulled)[number]], [ledger], "pdi9"),
    ).toEqual([]);
  });
});
