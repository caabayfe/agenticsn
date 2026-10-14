import { describe, expect, it } from "bun:test";
import { type FluentRecord, fluentRecordOf, holdsPublished, toPublish } from "@snagentic/core";

const xml = (table: string, fields: string, action = "INSERT_OR_UPDATE") =>
  `<?xml version="1.0"?>\n<record_update table="${table}">\n  <${table} action="${action}" apply_defaults="true">\n${fields}\n  </${table}>\n</record_update>`;

const flow = (type: string) =>
  fluentRecordOf(
    xml(
      "sys_hub_flow",
      `<sys_id>f1</sys_id><sys_update_name>sys_hub_flow_f1</sys_update_name><name>Page on-call</name><type>${type}</type>`,
    ),
  );

describe("Fluent build records", () => {
  it("reads a flow, a subflow, an action and any other record from the build's update XML", () => {
    expect(flow("flow")).toEqual({
      table: "sys_hub_flow",
      sysId: "f1",
      updateName: "sys_hub_flow_f1",
      name: "Page on-call",
      kind: "flow",
      action: "INSERT_OR_UPDATE",
    });
    expect(flow("subflow")?.kind).toBe("subflow");
    const action = fluentRecordOf(
      xml("sys_hub_action_type_definition", "<sys_id>a1</sys_id><name>Score</name>"),
    );
    expect(action).toMatchObject({ kind: "action", updateName: "" });
    const property = fluentRecordOf(xml("sys_properties", "<sys_id>p1</sys_id><name>x.on</name>"));
    expect(property?.kind).toBe("record");
  });

  it("reads a delete record, and nothing from a file that is not a record update", () => {
    expect(fluentRecordOf(xml("sys_choice", "<sys_id>c1</sys_id>", "DELETE"))?.action).toBe(
      "DELETE",
    );
    expect(fluentRecordOf("<unload/>")).toBeNull();
  });

  it("publishes flows and subflows together, actions apart, and never what is deleted", () => {
    const records: FluentRecord[] = [
      {
        table: "sys_hub_flow",
        sysId: "f1",
        updateName: "",
        name: "",
        kind: "flow",
        action: "INSERT_OR_UPDATE",
      },
      {
        table: "sys_hub_flow",
        sysId: "s1",
        updateName: "",
        name: "",
        kind: "subflow",
        action: "INSERT_OR_UPDATE",
      },
      {
        table: "sys_hub_flow",
        sysId: "f2",
        updateName: "",
        name: "",
        kind: "flow",
        action: "DELETE",
      },
      {
        table: "sys_hub_action_type_definition",
        sysId: "a1",
        updateName: "",
        name: "",
        kind: "action",
        action: "INSERT_OR_UPDATE",
      },
      {
        table: "sys_properties",
        sysId: "p1",
        updateName: "",
        name: "",
        kind: "record",
        action: "INSERT_OR_UPDATE",
      },
    ];
    expect(toPublish(records)).toEqual({ flows: ["f1", "s1"], actions: ["a1"] });
  });

  it("knows a captured update holds the published flow only with its status and snapshot", () => {
    const record = flow("flow");
    if (record === null) throw new Error("no record");
    const head = '<record_update table="sys_hub_flow"><sys_hub_flow action="INSERT_OR_UPDATE">';
    const snapshot = '<sys_hub_flow_snapshot action="INSERT_OR_UPDATE"/>';
    expect(
      holdsPublished(record, `${head}<status>published</status></sys_hub_flow>${snapshot}`),
    ).toBe(true);
    expect(holdsPublished(record, `${head}<status>draft</status></sys_hub_flow>`)).toBe(false);
    expect(holdsPublished(record, `${head}<status>published</status></sys_hub_flow>`)).toBe(false);
    const action = { ...record, kind: "action" as const };
    expect(holdsPublished(action, "<sys_hub_action_type_snapshot/>")).toBe(true);
    expect(holdsPublished(action, "<sys_hub_action_type_definition/>")).toBe(false);
    expect(holdsPublished({ ...record, kind: "record" }, "")).toBe(true);
  });
});
