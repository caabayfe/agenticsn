import { describe, expect, it } from "bun:test";
import {
  Catalog,
  CHILD_TABLES,
  childDocument,
  childFamily,
  classesToPull,
  namedByNestedTable,
  namedThroughChildRows,
  ownerOfBase,
  resolveThrough,
  spilledRow,
  variableModelOf,
} from "@snagentic/core";

const catalog = new Catalog({
  parents: {
    sys_metadata: null,
    sys_script: "sys_metadata",
    sys_cred: "sys_metadata",
    sys_hub_flow_snapshot: "sys_metadata",
    sys_dictionary: "sys_metadata",
    incident: null,
  },
  scopes: {},
  typedFields: {},
});

describe("what a full pull covers (ADR-0017)", () => {
  it("pulls every metadata class except credentials, derived snapshots and translations", () => {
    expect(classesToPull(catalog)).toEqual(["sys_dictionary", "sys_metadata", "sys_script"]);
  });

  it("lists child tables so that a parent child table comes before the tables that reference it", () => {
    const tables = CHILD_TABLES.map((child) => child.table);
    expect(tables.indexOf("wf_workflow_version")).toBeLessThan(tables.indexOf("wf_activity"));
    expect(tables.indexOf("wf_activity")).toBeLessThan(tables.indexOf("wf_condition"));
    expect(tables.indexOf("sys_hub_action_instance_v2")).toBeGreaterThanOrEqual(0);
  });
});

describe("spilled child rows (PERF-07)", () => {
  const row = (id: string, extra: Record<string, string> = {}) =>
    spilledRow({ sys_id: id, ...extra });

  it("writes an owner's rows sorted by sys_id, with the patterns their scans redacted", () => {
    const document = childDocument([
      row("b", { flow: "flow1", note: "AKIAIOSFODNN7EXAMPLE" }),
      row("a", { flow: "flow1" }),
    ]);
    expect(document).toEqual({
      rows: [
        { sys_id: "a", flow: "flow1" },
        { sys_id: "b", flow: "flow1", note: "[redacted:aws-access-key-id]" },
      ],
      patterns: ["aws-access-key-id"],
    });
  });

  it("gives rows named through a child row to the owner of the last row with that sys_id", () => {
    const joined = resolveThrough(
      [
        { kind: "owner", base: "global/wf_workflow/first--wf1" },
        { kind: "owner", base: "global/wf_workflow/later--wf2" },
        { kind: "row", row: row("v1") },
      ],
      "global/sys_script/direct--s1",
    );
    expect(joined.base).toBe("global/wf_workflow/later--wf2");
    expect(joined.rows.map((entry) => entry.id)).toEqual(["v1"]);
  });

  it("gives rows that name no child row to the record they name, or to nobody", () => {
    const entries = [{ kind: "row" as const, row: row("v1") }];
    expect(resolveThrough(entries, "global/sys_script/direct--s1").base).toBe(
      "global/sys_script/direct--s1",
    );
    expect(resolveThrough(entries, undefined).base).toBeUndefined();
  });

  it("keeps in memory only the sys_ids of tables a nested table names", () => {
    const kept = CHILD_TABLES.filter(namedByNestedTable).map((child) => child.table);
    expect(kept).toEqual(["wf_workflow_version", "wf_activity"]);
  });

  it("has one table owned through child rows, listed last, so every other table's ids are spilled for it", () => {
    const through = CHILD_TABLES.filter((child) => child.ownedThroughChildRows === true);
    expect(through.map((child) => child.table)).toEqual(["sys_variable_value"]);
    expect(CHILD_TABLES.at(-1)?.table).toBe("sys_variable_value");
    expect(CHILD_TABLES.slice(0, -1).every(namedThroughChildRows)).toBe(true);
    const last = CHILD_TABLES.at(-1);
    expect(last !== undefined && namedThroughChildRows(last)).toBe(false);
  });
});

describe("ownerOfBase", () => {
  it("reads the sys_id from a record path", () => {
    expect(ownerOfBase("x_acme/sys_script/raise-priority--0123456789abcdef0123456789abcdef")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    expect(ownerOfBase("global/sys_ui_view/default-view--Default view")).toBe("Default view");
  });
});

describe("childFamily", () => {
  it("is the table alone when nothing is nested under it", () => {
    expect(childFamily("sys_ui_element").map((child) => child.table)).toEqual(["sys_ui_element"]);
  });

  it("is the whole workflow family from any of its tables, parents first", () => {
    const family = [
      "wf_workflow_version",
      "wf_stage",
      "wf_activity",
      "wf_condition",
      "wf_transition",
    ];
    expect(childFamily("wf_condition").map((child) => child.table)).toEqual(family);
    expect(childFamily("wf_workflow_version").map((child) => child.table)).toEqual(family);
  });

  it("is empty for a table that is not a child table", () => {
    expect(childFamily("sys_script")).toEqual([]);
  });
});

describe("variableModelOf", () => {
  const model = "0123456789abcdef0123456789abcdef";

  it("names the record that defines a variable table", () => {
    expect(variableModelOf(`var__m_sys_hub_action_output_${model}`)).toBe(model);
    expect(variableModelOf(`var__m_atf_input_variable_${model}`)).toBe(model);
    expect(variableModelOf(`var__m_${model}`)).toBe(model);
  });

  it("names no record for an ordinary table or a malformed name", () => {
    expect(variableModelOf("incident")).toBeNull();
    expect(variableModelOf("var__m_sys_hub_flow_input")).toBeNull();
    expect(variableModelOf(`var__m_sys_hub_flow_input_${model.toUpperCase()}`)).toBeNull();
  });
});
