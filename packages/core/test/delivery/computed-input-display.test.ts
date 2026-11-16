import { describe, expect, it } from "bun:test";
import { capturedContentAgrees } from "@snagentic/core";
import { flowUnit } from "./flow-fixture";

function agrees(wanted: Record<string, unknown>, held: Record<string, unknown>) {
  const flow = flowUnit("unused");
  const row = {
    table: "sys_hub_action_instance_v2",
    sysId: "action",
    action: "INSERT_OR_UPDATE" as const,
    fields: { sys_id: "action", flow: flow.head.sysId, values: JSON.stringify([wanted]) },
    referenceNames: {},
  };
  const built = { ...flow, children: [row] };
  return capturedContentAgrees(built, {
    ...built,
    children: [{ ...row, fields: { ...row.fields, values: JSON.stringify([held]) } }],
  });
}
const input = (value: string, type: string) => ({
  name: "record",
  value,
  displayValue: value,
  scriptActive: false,
  parameter: { type },
});

describe("computed-input publication labels", () => {
  it("accepts the recorded generated labels only when the execution value is unchanged", () => {
    for (const entry of [
      input("{{subflow.problem}}", "document_id"),
      input('{"date_type":"relative","duration":90}', "schedule_date_time"),
    ]) {
      expect(agrees(entry, { ...entry, displayValue: "" })).toBe(true);
      expect(agrees(entry, { ...entry, displayValue: "", value: "changed" })).toBe(false);
      expect(agrees(entry, { ...entry, displayValue: "", scriptActive: true })).toBe(false);
      expect(agrees(entry, { ...entry, displayValue: "", parameter: { type: "string" } })).toBe(
        false,
      );
    }
  });
  it("requires explicit labels and does not ignore arbitrary or absent labels", () => {
    const entry = input("{{subflow.problem}}", "document_id");
    expect(
      agrees({ ...entry, displayValue: "Owner's label" }, { ...entry, displayValue: "" }),
    ).toBe(false);
    expect(agrees(entry, { ...entry, displayValue: "other" })).toBe(false);
    const { displayValue: _label, ...missing } = entry;
    expect(agrees(entry, missing)).toBe(false);
  });
  it("refuses unrecorded literal, parameter and date shapes", () => {
    for (const entry of [
      input("literal", "document_id"),
      input("{{subflow.problem}}", "string"),
      input("bad-json", "schedule_date_time"),
      input("null", "schedule_date_time"),
      input('{"date_type":"specific"}', "schedule_date_time"),
    ])
      expect(agrees(entry, { ...entry, displayValue: "" })).toBe(false);
    const numeric = { value: 42, displayValue: 42, parameter: { type: "document_id" } };
    expect(agrees(numeric, { ...numeric, displayValue: "" })).toBe(false);
    const noParameter = { value: "{{subflow.problem}}", displayValue: "{{subflow.problem}}" };
    expect(agrees(noParameter, { ...noParameter, displayValue: "" })).toBe(false);
  });
});
