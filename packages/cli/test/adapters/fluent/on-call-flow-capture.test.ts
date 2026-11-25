import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type BuiltUnit,
  capturedContentDifferences,
  type NativeTriggerContract,
  publishedCapture,
} from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi15-on-call-flow-2026-11-24",
);
const FLOWS = [
  "page-and-watch",
  "cancel-on-close",
  "created-or-updated",
  "created-or-updated-ends-itself",
] as const;

function load(folder: (typeof FLOWS)[number]) {
  const read = (file: string) => readFileSync(join(root, folder, file), "utf8");
  const built: BuiltUnit = JSON.parse(read("built.json"));
  const native: NativeTriggerContract = JSON.parse(read("native.json"));
  const references = new Map<string, string>(Object.entries(JSON.parse(read("references.json"))));
  const capture = builtUnitOf(`${built.updateName}.xml`, read("capture.xml"));
  const differences = (actual = capture, contract = native, wanted = built) =>
    capturedContentDifferences(wanted, actual, references, [contract]);
  return { built, native, capture, differences };
}

type Entry = Record<string, unknown> & { parameter?: Record<string, unknown> };

// One captured step with one of its inputs changed, as a tampered or unrecorded capture would hold it.
function changed(unit: BuiltUnit, row: string, name: string, change: (entry: Entry) => Entry) {
  const children = unit.children.map((child) => {
    if (child.sysId !== row) return child;
    const field = child.fields["values"] === undefined ? "subflow_inputs" : "values";
    const content = JSON.parse(child.fields[field] ?? "");
    const apply = (entries: Entry[]) =>
      entries.map((entry) => (entry["name"] === name ? change(entry) : entry));
    const next = Array.isArray(content)
      ? apply(content)
      : { ...content, inputs: apply(content.inputs) };
    return { ...child, fields: { ...child.fields, [field]: JSON.stringify(next) } };
  });
  return { ...unit, children };
}

const definitions = (
  contract: NativeTriggerContract,
  list: "actionInputs" | "logicInputs" | "subflowInputs",
  element: string,
  change: (row: Record<string, string>) => Record<string, string> | null,
): NativeTriggerContract => ({
  ...contract,
  [list]: (contract[list] ?? []).flatMap((row) => {
    if (row["element"] !== element) return [row];
    const next = change({ ...row });
    return next === null ? [] : [next];
  }),
});

const ESCALATION_DETAILS = "ddeee8a8de59407e81e33f8244a054a6";
const WAIT_FOR_CONDITION = "8ab98cf68515496ab8374d466520f5b2";
const END_THE_PAGE = "987b728ab97048bcacb87f07b5a16a07";
const SET_VARIABLES = "285ce419dab9427b8482d8c53133fca3";
const WAIT_A_DURATION = "9a2502379ad24c0da03d98a5e44092bc";
const PAGING_SUBFLOW = "44a03876d6a84a6987d3da7d8f3e27d6";

describe("published on-call flows captured on PDI15", () => {
  for (const folder of FLOWS) {
    it(`agrees with its build: ${folder}`, () => {
      const flow = load(folder);
      expect(publishedCapture(flow.capture)).toBe(true);
      expect(flow.differences()).toEqual([]);
    });
  }

  const flow = load("page-and-watch");
  const refused = (actual: BuiltUnit, contract = flow.native) =>
    expect(flow.differences(actual, contract)).not.toEqual([]);

  describe("a Created or Updated trigger", () => {
    const created = load("created-or-updated");

    it("fails closed without the native trigger definition", () => {
      expect(created.differences(created.capture, { ...created.native, outputs: [] })).not.toEqual(
        [],
      );
    });

    it("refuses a Created trigger, which no capture has recorded", () => {
      const only = (unit: BuiltUnit) => ({
        ...unit,
        children: unit.children.map((row) =>
          row.table === "sys_hub_trigger_instance_v2"
            ? { ...row, fields: { ...row.fields, trigger_type: "record_create" } }
            : row,
        ),
      });
      expect(
        created.differences(only(created.capture), created.native, only(created.built)),
      ).not.toEqual([]);
    });
  });

  describe("an input of an action called by its id", () => {
    it("refuses a captured type that is not the action's own", () => {
      refused(
        changed(flow.capture, ESCALATION_DETAILS, "group_id", (entry) => ({
          ...entry,
          parameter: { ...entry.parameter, type: "reference" },
        })),
      );
      refused(
        flow.capture,
        definitions(flow.native, "actionInputs", "group_id", (row) => ({
          ...row,
          internal_type: "reference",
        })),
      );
    });

    it("refuses a changed value", () => {
      refused(
        changed(flow.capture, ESCALATION_DETAILS, "group_id", (entry) => ({
          ...entry,
          value: "{{flow_variable.start_group_name}}",
        })),
      );
    });
  });

  describe("an input the build describes by its script alone", () => {
    it("refuses a changed script", () => {
      refused(
        changed(flow.capture, END_THE_PAGE, "own_context", (entry) => ({
          ...entry,
          script: { own_context: { scriptActive: true, script: "return 'another run';" } },
        })),
      );
    });

    it("refuses a description that carries a value", () => {
      refused(
        changed(flow.capture, END_THE_PAGE, "own_context", (entry) => ({
          ...entry,
          parameter: { ...entry.parameter, value: "another run" },
        })),
      );
    });

    it("refuses a description that is not the action's input definition", () => {
      refused(
        changed(flow.capture, END_THE_PAGE, "own_context", (entry) => ({
          ...entry,
          parameter: { ...entry.parameter, label: "Another input" },
        })),
      );
      for (const change of [{ order: 7 }, { maxsize: 4000 }, { hint: "Paste a run" }])
        refused(
          changed(flow.capture, END_THE_PAGE, "own_context", (entry) => ({
            ...entry,
            parameter: { ...entry.parameter, ...change },
          })),
        );
      refused(
        flow.capture,
        definitions(flow.native, "actionInputs", "own_context", () => null),
      );
    });
  });

  describe("an optional switch the build leaves out", () => {
    it("refuses the switch turned on", () => {
      refused(
        changed(flow.capture, WAIT_FOR_CONDITION, "timeout_flag", (entry) => ({
          ...entry,
          value: "1",
          displayValue: "true",
        })),
      );
    });

    it("refuses it when the definition makes it mandatory or gives it a default", () => {
      for (const field of ["mandatory", "default_value"])
        refused(
          flow.capture,
          definitions(flow.native, "actionInputs", "timeout_flag", (row) => ({
            ...row,
            [field]: "true",
          })),
        );
    });
  });

  describe("a flow variable assignment", () => {
    it("refuses a caption that is not the assigned value", () => {
      refused(
        changed(flow.capture, SET_VARIABLES, "start_group", (entry) => ({
          ...entry,
          displayValue: "{{Updated_1.current.assignment_group.name}}",
        })),
      );
    });

    it("refuses a changed assignment", () => {
      refused(
        changed(flow.capture, SET_VARIABLES, "start_group", (entry) => ({
          ...entry,
          value: "{{Updated_1.current.assigned_to}}",
          displayValue: "{{Updated_1.current.assigned_to}}",
        })),
      );
    });
  });

  describe("a wait for a duration", () => {
    it("refuses a caption that reads as another duration, or cannot be read", () => {
      for (const displayValue of ["45 Seconds", "30 Minutes", "soon", ""])
        refused(
          changed(flow.capture, WAIT_A_DURATION, "timer_duration", (entry) => ({
            ...entry,
            displayValue,
          })),
        );
    });

    it("refuses a missing caption beside a value", () => {
      refused(
        changed(flow.capture, WAIT_A_DURATION, "timer_relative_duration_operator", (entry) => ({
          ...entry,
          value: "before",
        })),
      );
    });

    it("refuses a description without the native input definition", () => {
      refused(
        flow.capture,
        definitions(flow.native, "logicInputs", "timer_schedule", () => null),
      );
    });
  });

  describe("a subflow called with some of its inputs", () => {
    it("refuses a left-out input that holds a value", () => {
      refused(
        changed(flow.capture, PAGING_SUBFLOW, "parent_escalation_level", (entry) => ({
          ...entry,
          value: "2",
        })),
      );
    });

    it("fails closed without the subflow's native input definitions", () => {
      refused(flow.capture, { ...flow.native, subflowInputs: [] });
    });

    it("refuses a left-out input the subflow makes mandatory", () => {
      refused(
        flow.capture,
        definitions(flow.native, "subflowInputs", "parent_escalation_level", (row) => ({
          ...row,
          mandatory: "true",
        })),
      );
    });
  });
});
