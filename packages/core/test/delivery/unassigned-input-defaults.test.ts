import { describe, expect, it } from "bun:test";
import { withoutUnassignedFields } from "../../src/authoring/domain/compiled-input-defaults";

const wanted = [{ name: "record", value: "{{subflow.problem}}" }];
const optional = {
  name: "journal_field",
  displayValue: "",
  scriptActive: false,
  parameter: { type: "field_name", mandatory: false, defaultValue: "", name: "journal_field" },
};

describe("native unassigned optional input descriptors", () => {
  it("recognizes the recorded optional field descriptor without an execution value", () => {
    expect(withoutUnassignedFields(wanted, [...wanted, optional])).toEqual(wanted);
    expect(withoutUnassignedFields([], [optional])).toEqual([]);
  });
  it("retains assignments, scripts, defaults, unknown shapes and duplicate descriptors", () => {
    for (const entry of [
      { ...optional, value: "work_notes" },
      { ...optional, value: "" },
      { ...optional, scriptActive: true },
      { ...optional, displayValue: "journal" },
      { ...optional, script: "run()" },
      { ...optional, parameter: { ...optional.parameter, mandatory: true } },
      { ...optional, parameter: { ...optional.parameter, defaultValue: "work_notes" } },
      { ...optional, parameter: { ...optional.parameter, type: "script" } },
      { ...optional, parameter: { ...optional.parameter, name: "other" } },
      { ...optional, parameter: null },
      { ...optional, name: 42 },
      { ...optional, name: "record" },
      null,
      42,
    ])
      expect(withoutUnassignedFields(wanted, [...wanted, entry])).toEqual([...wanted, entry]);
    expect(withoutUnassignedFields(wanted, [...wanted, optional, optional])).toHaveLength(2);
  });
  it("does not normalize arrays without named input records or non-array values", () => {
    for (const value of [null, 4, {}])
      expect(withoutUnassignedFields(wanted, value)).toEqual(value);
    for (const source of [null, 4, {}, [42], [{ name: 42 }], [null]])
      expect(withoutUnassignedFields(source, [optional])).toEqual([optional]);
  });
});
