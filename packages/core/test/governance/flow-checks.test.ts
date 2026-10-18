import { describe, expect, it } from "bun:test";
import { type BuiltUnit, validate } from "@snagentic/core";
import { flowTriggerHits } from "../../src/governance/domain/flow-checks";
import { governanceOf } from "../support/fake-governance";

// pdi2, 2026-10-18 (spec 009 L8 A1): a record-triggered flow the SDK built with an empty condition
// was published and registered, yet never ran; with '^EQ', as Flow Designer writes "no
// condition", it ran within 10 s. None of the instance's 113 active record triggers is empty.

const inputs = (condition: string) =>
  JSON.stringify([
    { name: "table", value: "x_app_request" },
    { name: "condition", value: condition },
  ]);

function flow(triggerType: string, condition: string): BuiltUnit {
  const id = "f".repeat(32);
  return {
    updateName: `sys_hub_flow_${id}`,
    file: `sys_hub_flow_${id}.xml`,
    head: {
      table: "sys_hub_flow",
      sysId: id,
      action: "INSERT_OR_UPDATE",
      fields: { sys_id: id, name: "Route new requests", description: "Routes requests" },
      referenceNames: {},
    },
    children: [
      {
        table: "sys_hub_trigger_instance_v2",
        sysId: "e".repeat(32),
        action: "INSERT_OR_UPDATE",
        fields: { trigger_type: triggerType, trigger_inputs: inputs(condition) },
        referenceNames: {},
      },
    ],
  };
}

describe("a record-triggered flow's condition (SN-MNT-018)", () => {
  it("flags a record trigger with an empty condition: the platform never runs it", () => {
    expect(flowTriggerHits(flow("record_create", ""))).toEqual([
      {
        ruleId: "SN-MNT-018",
        field: "trigger_inputs",
        message:
          "the record trigger's condition is empty, so the flow never runs: write condition: '^EQ' to run it for every record",
      },
    ]);
    expect(flowTriggerHits(flow("record_update", "  "))).toHaveLength(1);
  });

  it("accepts a condition, '^EQ', and triggers that are not on records", () => {
    expect(flowTriggerHits(flow("record_create", "^EQ"))).toEqual([]);
    expect(flowTriggerHits(flow("record_create", "active=true"))).toEqual([]);
    expect(flowTriggerHits(flow("inbound_email", ""))).toEqual([]);
  });

  it("judges nothing it can't read: inputs that don't parse or name no condition", () => {
    const withInputs = (trigger_inputs: string) => {
      const unit = flow("record_create", "");
      const [row] = unit.children;
      return row === undefined
        ? unit
        : { ...unit, children: [{ ...row, fields: { ...row.fields, trigger_inputs } }] };
    };
    expect(flowTriggerHits(withInputs("not json"))).toEqual([]);
    expect(flowTriggerHits(withInputs('{"condition":""}'))).toEqual([]);
    expect(flowTriggerHits(withInputs('[null, {"name":"table","value":"x"}]'))).toEqual([]);
    expect(flowTriggerHits(withInputs('[{"name":"condition"}]'))).toHaveLength(1);
  });

  it("blocks the change in validate, at the flow's unit", async () => {
    const unit = flow("record_create", "");
    const result = await validate(governanceOf({ "source/x_app": { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.findings.map((f) => [f.ruleId, f.severity, f.path])).toContainEqual([
      "SN-MNT-018",
      "block",
      `source/x_app/${unit.updateName}`,
    ]);
    expect(result.passed).toBe(false);
  });
});
