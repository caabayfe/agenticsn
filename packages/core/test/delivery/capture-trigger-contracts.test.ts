import { describe, expect, it } from "bun:test";
import { type BuiltUnit, TRIGGER_OUTPUT_FIELDS, type UnitRecord } from "@snagentic/core";
import {
  captureLogicInputs,
  captureTriggerContracts,
} from "../../src/delivery/application/capture-trigger-contracts";
import { reconcilePending } from "../../src/delivery/application/reconcile-pending";
import { fakeInstance } from "../support/fake-instance";

const ID = "a".repeat(32);
const ACTION = "b".repeat(32);
const LOGIC = "c".repeat(32);
const SCHEMA = `FD${"d".repeat(32)}`;
const signal = new AbortController().signal;
const record = (table: string, sysId: string, fields: Record<string, string>): UnitRecord => ({
  table,
  sysId,
  fields,
  action: "INSERT_OR_UPDATE",
  referenceNames: {},
});
const unit = (definition = ID): BuiltUnit => ({
  updateName: `sys_hub_flow_${ID}`,
  file: "flow.xml",
  head: record("sys_hub_flow", ID, {}),
  children: [
    record("sys_hub_trigger_instance_v2", "trigger", {
      trigger_type: "sla_task",
      trigger_definition: definition,
    }),
    record("sys_hub_action_instance_v2", "action", { action_type: ACTION }),
    record("sys_hub_flow_logic_instance_v2", "logic", { logic_definition: LOGIC }),
  ],
});

describe("native trigger capture evidence", () => {
  it("reads independent optional logic contracts for changed subflows through bounded keyset pages", async () => {
    const row = {
      sys_id: "input",
      model: LOGIC,
      element: "condition_name",
      internal_type: "string",
      default_value: "",
      mandatory: "false",
      attributes: "",
    };
    const fake = fakeInstance({ sys_hub_flow_logic_input: [row] });
    const built = {
      ...unit(),
      head: record("sys_hub_flow", ID, { type: "subflow" }),
      children: unit().children.filter((row) => row.table !== "sys_hub_trigger_instance_v2"),
    };
    expect(await captureLogicInputs(fake.reader, built, signal)).toEqual([row]);
    expect(fake.queries).toHaveLength(2);
    expect(
      fake.queries.every(
        (query) =>
          query.table === "sys_hub_flow_logic_input" && query.query.includes(`modelIN${LOGIC}`),
      ),
    ).toBe(true);
    expect(fake.writes).toEqual([]);
  });

  it("reads the same independently defined branch inputs for ordinary flows", async () => {
    const fake = fakeInstance({});
    const built = {
      ...unit(),
      head: record("sys_hub_flow", ID, { type: "flow" }),
      children: unit().children.filter((row) => row.table !== "sys_hub_trigger_instance_v2"),
    };
    expect(await captureLogicInputs(fake.reader, built, signal)).toEqual([]);
    expect(fake.queries).toHaveLength(1);
    expect(String(fake.queries[0]?.table)).toBe("sys_hub_flow_logic_input");
  });

  it("adds no logic-contract reads for unrelated definitions or subflows without logic", async () => {
    const fake = fakeInstance({});
    for (const built of [
      unit(),
      { ...unit(), head: record("sys_hub_flow", ID, { type: "flow" }) },
      { ...unit(), head: record("sys_hub_flow", ID, { type: "subflow" }), children: [] },
    ])
      expect(await captureLogicInputs(fake.reader, built, signal)).toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  it("reads native output, schema and parameter contracts through indexed paged queries", async () => {
    const output = {
      ...Object.fromEntries(TRIGGER_OUTPUT_FIELDS.map((field) => [field, ""])),
      sys_id: "1",
      model: ID,
      element: "inputs",
      attributes: `co_type_name=${SCHEMA}`,
    };
    const fake = fakeInstance({
      sys_hub_trigger_output: [output, { ...output, sys_id: "2", model: ACTION }],
      sys_complex_object: [
        {
          sys_id: "3",
          name: SCHEMA,
          namespace: "FlowDesigner",
          type: "complex_object_schema",
          scope_name: "global",
          serialized_content: "{}",
        },
      ],
      sys_hub_action_input: [
        { sys_id: "4", model: ACTION, element: "optional", mandatory: "false", default_value: "" },
      ],
      sys_hub_flow_logic_input: [
        {
          sys_id: "5",
          model: LOGIC,
          element: "condition_name",
          mandatory: "false",
          default_value: "",
        },
      ],
    });
    const contracts = await captureTriggerContracts(fake.reader, unit(), signal);
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.outputs).toEqual([output]);
    expect(contracts[0]?.schemas).toHaveLength(1);
    expect(contracts[0]?.actionInputs?.[0]?.["model"]).toBe(ACTION);
    expect(contracts[0]?.logicInputs?.[0]?.["model"]).toBe(LOGIC);
    expect(fake.writes).toEqual([]);
    expect(fake.queries.every((query) => query.fields !== "all" && query.fields.length > 0)).toBe(
      true,
    );
    expect(fake.queries.every((query) => !/LIKE|CONTAINS|offset/i.test(query.query))).toBe(true);
  });

  it("does not query native contracts for unrelated or malformed definitions", async () => {
    const fake = fakeInstance({});
    for (const built of [
      unit("bad^query"),
      { ...unit(), children: [] },
      { ...unit(), head: record("sys_script", ID, {}) },
    ]) {
      expect(await captureTriggerContracts(fake.reader, built, signal)).toEqual([]);
    }
    expect(fake.reader.stats().requests).toBe(0);
  });

  it("preserves missing native evidence instead of guessing a generated schema", async () => {
    const contracts = await captureTriggerContracts(fakeInstance({}).reader, unit(), signal);
    expect(contracts[0]?.outputs).toEqual([]);
    expect(contracts[0]?.schemas).toEqual([]);
  });

  it("reconciles unchanged published evidence read-only and refuses missing contracts or moved versions", async () => {
    const built = { ...unit(), children: unit().children.slice(0, 1) };
    const output = {
      ...Object.fromEntries(TRIGGER_OUTPUT_FIELDS.map((field) => [field, ""])),
      sys_id: "out",
      model: ID,
      element: "task_sla_record",
      internal_type: "reference",
      reference: "task_sla",
      mandatory: "true",
      active: "true",
    };
    const actual = {
      ...built,
      head: record("sys_hub_flow", ID, {
        status: "published",
        remote_trigger_id: "runtime",
        master_snapshot: "snapshot",
      }),
      children: [
        ...built.children,
        record("sys_flow_trigger", "runtime", { name: "sla_task", active: "true" }),
        record("sys_hub_flow_input", "input", { ...output, sys_id: "input", model: ID }),
        record("sys_hub_flow_snapshot", "snapshot", { parent_flow: ID, master: "true" }),
      ],
    };
    const pending = {
      project: "source/global",
      updateName: built.updateName,
      digest: "digest",
      updateSet: "set",
      before: null,
      observed: "version",
      operation: "create" as const,
      removes: null,
    };
    const copy = { head: actual.head.fields, children: [], version: "version", foreignRows: 0 };
    const fake = fakeInstance({
      sys_update_xml: [
        { sys_id: "capture", name: built.updateName, update_set: "set", payload: "published" },
      ],
      sys_hub_trigger_output: [output],
    });
    const decode = () => ({ unit: actual, published: true });
    expect(
      (await reconcilePending(fake.reader, built, pending, copy, decode, signal)).verified,
    ).toBe(true);
    expect(
      (
        await reconcilePending(
          fake.reader,
          built,
          pending,
          { ...copy, version: "moved" },
          decode,
          signal,
        )
      ).verified,
    ).not.toBe(true);
    const missing = fakeInstance({
      sys_update_xml: [
        { sys_id: "capture", name: built.updateName, update_set: "set", payload: "published" },
      ],
    });
    expect(
      (await reconcilePending(missing.reader, built, pending, copy, decode, signal)).verified,
    ).not.toBe(true);
    expect(fake.writes).toEqual([]);
  });
});
