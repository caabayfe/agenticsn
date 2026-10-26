import { describe, expect, it } from "bun:test";
import { mismatchesOf } from "../../src/delivery/domain/unit-plan";

// What a push says about a unit that reads back otherwise: enough to tell a real problem from a
// field the platform sets its own way, without opening the instance.
describe("mismatchesOf", () => {
  it("names the field, the row and both values, shortened to a line", () => {
    const long = `${"x".repeat(80)}\n  more`;
    expect(
      mismatchesOf([
        {
          kind: "field",
          table: "sc_cat_item",
          row: "",
          field: "version",
          built: "1",
          instance: "3",
        },
        {
          kind: "field",
          table: "sys_choice",
          row: "new|en",
          field: "label",
          built: long,
          instance: "",
        },
      ]),
    ).toEqual([
      'sc_cat_item.version: built "1", instance "3"',
      `sys_choice [new|en].label: built "${"x".repeat(57)}...", instance ""`,
    ]);
  });

  it("names the rows each side holds", () => {
    expect(
      mismatchesOf([
        {
          kind: "rows",
          table: "sys_ui_list_element",
          built: ["number", "state"],
          instance: ["number"],
        },
      ]),
    ).toEqual(["sys_ui_list_element rows: built [number, state], instance [number]"]);
  });
});
