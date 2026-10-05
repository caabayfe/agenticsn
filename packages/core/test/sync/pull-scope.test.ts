import { describe, expect, it } from "bun:test";
import {
  attachChildren,
  Catalog,
  CHILD_TABLES,
  childFamily,
  childGrouper,
  classesToPull,
  OPERATIONAL_TABLES,
  ownerOfBase,
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

  it("names the curated fields of each operational table", () => {
    expect(OPERATIONAL_TABLES.map((table) => table.table)).toEqual([
      "v_plugin",
      "sys_plugins",
      "sys_store_app",
      "domain",
    ]);
    expect(OPERATIONAL_TABLES.every((table) => table.fields.includes(table.key))).toBe(true);
  });
});

describe("attachChildren", () => {
  it("groups child rows under the record that owns them, sorted by sys_id", () => {
    const owners = new Map([["flow1", "global/sys_hub_flow/my-flow--flow1"]]);
    const grouped = attachChildren(
      [
        { sys_id: "b", flow: "flow1", order: "2" },
        { sys_id: "a", flow: "flow1", order: "1" },
        { sys_id: "c", flow: "unknown", order: "3" },
      ],
      "flow",
      owners,
    );
    expect([...grouped.attached]).toEqual([
      [
        "global/sys_hub_flow/my-flow--flow1",
        [
          { sys_id: "a", flow: "flow1", order: "1" },
          { sys_id: "b", flow: "flow1", order: "2" },
        ],
      ],
    ]);
    expect(grouped.orphans).toBe(1);
  });

  it("lets nested child rows find their owner through an earlier child table", () => {
    const owners = new Map([["wf1", "global/wf_workflow/approve--wf1"]]);
    const versions = attachChildren([{ sys_id: "v1", workflow: "wf1" }], "workflow", owners);
    const activities = attachChildren(
      [{ sys_id: "act1", workflow_version: "v1" }],
      "workflow_version",
      owners,
    );
    expect(versions.orphans).toBe(0);
    expect([...activities.attached.keys()]).toEqual(["global/wf_workflow/approve--wf1"]);
  });
});

describe("childGrouper", () => {
  it("groups streamed child rows like attachChildren, without holding the table twice", () => {
    const owners = new Map([["flow1", "global/sys_hub_flow/my-flow--flow1"]]);
    const grouper = childGrouper("flow", owners);
    for (const row of [
      { sys_id: "b", flow: "flow1" },
      { sys_id: "a", flow: "flow1" },
      { sys_id: "c", flow: "x" },
    ]) {
      grouper.add(row);
    }
    const grouped = grouper.result();
    expect([...grouped.attached]).toEqual([
      [
        "global/sys_hub_flow/my-flow--flow1",
        [
          { sys_id: "a", flow: "flow1" },
          { sys_id: "b", flow: "flow1" },
        ],
      ],
    ]);
    expect(grouped.orphans).toBe(1);
    expect(owners.get("a")).toBe("global/sys_hub_flow/my-flow--flow1");
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
