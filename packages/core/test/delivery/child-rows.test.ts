import { describe, expect, it } from "bun:test";
import { childRowChanges } from "@snagentic/core";

const SECTION_ID = "0123456789abcdef0123456789abcdef";
const TABLE_ID = "11111111111111111111111111111111";
const NEW_ROW = "fedcba9876543210fedcba9876543210";
const ELEMENTS = `global/sys_ui_section/u-review--${SECTION_ID}.children.sys_ui_element.yaml`;
const CHOICES = `global/sys_db_object/u-review--${TABLE_ID}.children.sys_choice.yaml`;

const section = { table: "sys_ui_section", sysId: SECTION_ID, scope: "global", name: "u_review" };
const table = { table: "sys_db_object", sysId: TABLE_ID, scope: "global", name: "u_review" };

// A row as pull writes it: content fields and the platform's provenance.
const pulled = (sysId: string, fields: Record<string, string>) => ({
  sys_id: sysId,
  sys_created_by: "admin",
  sys_created_on: "2026-10-13 10:00:00",
  sys_mod_count: "0",
  sys_updated_by: "admin",
  sys_updated_on: "2026-10-13 10:00:00",
  ...fields,
});

describe("childRowChanges (ADR-0025)", () => {
  it("creates a new row with its content fields, the owner's scope, after its owner", () => {
    const row = { sys_id: NEW_ROW, sys_ui_section: SECTION_ID, element: "decision", position: "2" };
    expect(childRowChanges(ELEMENTS, section, null, [row])).toEqual({
      problems: [],
      writes: [
        {
          operation: "create",
          table: "sys_ui_element",
          sysId: NEW_ROW,
          scope: "global",
          path: ELEMENTS,
          values: { sys_ui_section: SECTION_ID, element: "decision", position: "2" },
          baseHash: null,
          owner: { table: "sys_ui_section", sysId: SECTION_ID },
          updateName: null,
        },
      ],
    });
  });

  it("updates only the fields that changed, guarded by the row's version as pulled", () => {
    const before = [
      pulled(NEW_ROW, { sys_ui_section: SECTION_ID, element: "state", position: "1" }),
    ];
    const now = [{ ...before[0], position: "3" }];
    const { writes } = childRowChanges(ELEMENTS, section, before, now);
    expect(writes).toEqual([
      expect.objectContaining({
        operation: "update",
        values: { position: "3" },
        baseHash: "0|2026-10-13 10:00:00",
      }),
    ]);
    expect(childRowChanges(ELEMENTS, section, before, before).writes).toEqual([]);
  });

  it("names a table's choices the way the update set records them", () => {
    const row = { sys_id: NEW_ROW, name: "u_review", element: "decision", value: "keep" };
    const { writes, problems } = childRowChanges(CHOICES, table, null, [row]);
    expect(problems).toEqual([]);
    expect(writes[0]).toMatchObject({
      table: "sys_choice",
      updateName: "sys_choice_u_review_decision",
      owner: { table: "sys_db_object", sysId: TABLE_ID },
    });
  });

  it("refuses removed rows, saying how to retire each kind", () => {
    const choice = pulled(NEW_ROW, { name: "u_review", element: "decision", value: "keep" });
    expect(childRowChanges(CHOICES, table, [choice], []).problems).toEqual([
      { path: CHOICES, reason: expect.stringContaining("set inactive to true") },
    ]);
    const field = pulled(NEW_ROW, { sys_ui_section: SECTION_ID, element: "state" });
    expect(childRowChanges(ELEMENTS, section, [field], null).problems).toEqual([
      { path: ELEMENTS, reason: expect.stringContaining("remove it on the instance") },
    ]);
  });

  it("refuses a row that names another owner, or has no proper sys_id", () => {
    const other = { sys_id: NEW_ROW, sys_ui_section: "f".repeat(32), element: "x" };
    const choice = { sys_id: NEW_ROW, name: "incident", element: "x", value: "y" };
    const unnamed = { sys_ui_section: SECTION_ID, element: "x" };
    for (const [path, owner, row] of [
      [ELEMENTS, section, other],
      [CHOICES, table, choice],
      [ELEMENTS, section, unnamed],
    ] as const) {
      expect(childRowChanges(path, owner, null, [row]).writes).toEqual([]);
      expect(childRowChanges(path, owner, null, [row]).problems).toHaveLength(1);
    }
  });

  it("keeps flow and workflow rows read-only, and needs the owning record", () => {
    const flow = `global/sys_hub_flow/f--${SECTION_ID}.children.sys_hub_flow_stage.yaml`;
    expect(childRowChanges(flow, section, null, [{ sys_id: NEW_ROW }]).problems).toEqual([
      { path: flow, reason: expect.stringContaining("read-only") },
    ]);
    expect(childRowChanges(ELEMENTS, null, null, []).problems).toEqual([
      { path: ELEMENTS, reason: expect.stringContaining("owning record") },
    ]);
  });

  it("refuses a file that is not a list of rows", () => {
    expect(childRowChanges(ELEMENTS, section, null, { element: "x" }).problems).toEqual([
      { path: ELEMENTS, reason: expect.stringContaining("list of rows") },
    ]);
  });
});
