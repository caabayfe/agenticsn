import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capturedContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi12-sla-trigger-2026-11-15",
);
const name = "sys_hub_flow_3ad20e12b1523d5738e3e890f3a625ff.xml";
const built = builtUnitOf(name, readFileSync(join(root, "built.xml"), "utf8"));
const actual = builtUnitOf(name, readFileSync(join(root, "capture.xml"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "native-contract.json"), "utf8"));
const agrees = (unit = actual, contracts = [contract]) =>
  capturedContentAgrees(built, unit, new Map(), contracts);

function changedInput(name: string, change: (entry: Record<string, unknown>) => void) {
  return {
    ...actual,
    children: actual.children.map((row) => {
      if (
        row.table !== "sys_hub_action_instance_v2" ||
        !built.children.some((wanted) => wanted.sysId === row.sysId)
      )
        return row;
      const values = JSON.parse(row.fields["values"] ?? "[]");
      for (const entry of values) if (entry.name === name) change(entry);
      return { ...row, fields: { ...row.fields, values: JSON.stringify(values) } };
    }),
  };
}

describe("published native SLA Task capture", () => {
  it("refuses deletion captures for generated inputs, schemas and runtime triggers", () => {
    for (const table of ["sys_complex_object", "sys_hub_flow_input", "sys_flow_trigger"]) {
      const changed = {
        ...actual,
        children: actual.children.map((row) =>
          row.table === table ? { ...row, action: "DELETE" as const } : row,
        ),
      };
      expect(agrees(changed)).toBe(false);
    }
  });
  it("verifies generated runtime inputs and schemas against the native trigger contract", () => {
    expect(publishedCapture(actual)).toBe(true);
    expect(agrees()).toBe(true);
    expect(agrees(actual, [])).toBe(false);
  });

  it("refuses a changed authored event and a missing authored timer", () => {
    const authored = built.children.find(
      (r) => r.table === "sys_hub_action_instance_v2" && r.sysId !== "",
    );
    if (!authored) throw new Error("missing authored action");
    expect(
      agrees({
        ...actual,
        children: actual.children.map((r) =>
          r.sysId === authored.sysId ? { ...r, fields: { ...r.fields, values: "changed" } } : r,
        ),
      }),
    ).toBe(false);
    expect(
      agrees({ ...actual, children: actual.children.filter((r) => r.sysId !== authored.sysId) }),
    ).toBe(false);
  });

  it("refuses unknown extra inputs and a runtime input with the wrong owner or type", () => {
    const input = actual.children.find(
      (r) =>
        r.table === "sys_hub_flow_input" &&
        r.fields["model"] === actual.head.sysId &&
        r.fields["element"] === "task_sla_record",
    );
    if (!input) throw new Error("missing generated input");
    for (const patch of [
      { element: "unexpected" },
      { model: "other" },
      { reference: "sys_user" },
      { mandatory: "false" },
    ]) {
      expect(
        agrees({
          ...actual,
          children: actual.children.map((r) =>
            r === input ? { ...r, fields: { ...r.fields, ...patch } } : r,
          ),
        }),
      ).toBe(false);
    }
  });

  it("refuses foreign runtime trigger and changed, unrelated or unproven schemas", () => {
    const schema = actual.children.find((r) => r.table === "sys_complex_object");
    if (!schema) throw new Error("missing generated schema");
    for (const patch of [
      { serialized_content: "{}" },
      { namespace: "Other" },
      { name: "Unrelated" },
    ]) {
      expect(
        agrees({
          ...actual,
          children: actual.children.map((r) =>
            r === schema ? { ...r, fields: { ...r.fields, ...patch } } : r,
          ),
        }),
      ).toBe(false);
    }
    expect(agrees(actual, [{ ...contract, schemas: [] }])).toBe(false);
    expect(
      agrees({
        ...actual,
        head: { ...actual.head, fields: { ...actual.head.fields, remote_trigger_id: "other" } },
      }),
    ).toBe(false);
    expect(agrees(actual, [{ ...contract, definitionId: "other" }])).toBe(false);
  });

  it("keeps percentages, event IDs, record pills and scripts as authored execution values", () => {
    for (const name of ["percentage", "event_name", "record"]) {
      expect(
        agrees(
          changedInput(name, (entry) => {
            entry["value"] = "changed";
          }),
        ),
      ).toBe(false);
    }
    expect(
      agrees(
        changedInput("percentage", (entry) => {
          entry["scriptActive"] = true;
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("percentage", (entry) => {
          entry["displayValue"] = "51";
        }),
      ),
    ).toBe(false);
  });

  it("does not discard nonempty, scripted, duplicated or unproven optional native inputs", () => {
    expect(
      agrees(
        changedInput("parm1", (entry) => {
          entry["value"] = "not empty";
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("parm1", (entry) => {
          entry["scriptActive"] = true;
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("parm1", (entry) => {
          entry["parameter"] = {};
        }),
      ),
    ).toBe(false);
    expect(agrees(actual, [{ ...contract, actionInputs: [] }])).toBe(false);
    expect(agrees(actual, [{ ...contract, logicInputs: [] }])).toBe(false);
    const duplicate = {
      ...actual,
      children: actual.children.map((row) => {
        if (
          row.table !== "sys_hub_action_instance_v2" ||
          !built.children.some((wanted) => wanted.sysId === row.sysId)
        )
          return row;
        const values = JSON.parse(row.fields["values"] ?? "[]");
        const parameter = values.find(
          (entry: Record<string, unknown>) => entry["name"] === "parm1",
        );
        return parameter === undefined
          ? row
          : { ...row, fields: { ...row.fields, values: JSON.stringify([...values, parameter]) } };
      }),
    };
    expect(agrees(duplicate)).toBe(false);
  });

  it("accepts only the empty native complex value with inactive scripts and matching field membership", () => {
    expect(
      agrees(
        changedInput("sla_flow_inputs", (entry) => {
          entry["scriptActive"] = true;
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("sla_flow_inputs", (entry) => {
          const inner = JSON.parse(String(entry["value"]));
          inner.complexObject.duration.$cv.$v = "a real duration";
          entry["value"] = JSON.stringify(inner);
          entry["displayValue"] = entry["value"];
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("sla_flow_inputs", (entry) => {
          entry["children"] = [];
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("sla_flow_inputs", (entry) => {
          const parameter = JSON.parse(JSON.stringify(entry["parameter"]));
          parameter.scriptActive = true;
          entry["parameter"] = parameter;
        }),
      ),
    ).toBe(false);
    expect(
      agrees(
        changedInput("sla_flow_inputs", (entry) => {
          entry["value"] = "unreadable";
        }),
      ),
    ).toBe(false);
    expect(agrees(actual, [{ ...contract, outputs: [] }])).toBe(false);
    const missing = actual.children.find(
      (row) => row.table === "sys_hub_flow_input" && row.fields["model"] === actual.head.sysId,
    );
    expect(agrees({ ...actual, children: actual.children.filter((row) => row !== missing) })).toBe(
      false,
    );
  });
});
