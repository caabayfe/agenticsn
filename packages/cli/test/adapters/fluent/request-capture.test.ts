import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BuiltUnit, capturedContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi12-request-2026-11-16",
);
const references = new Map([
  ["4874a9d2836817102e6494b6feaad315", "e47d7a531b022ca88a2ff402a3a3d0d1"],
]);
const logicInputs: readonly Readonly<Record<string, string>>[] = JSON.parse(
  readFileSync(join(root, "logic-inputs.json"), "utf8"),
);
function changed(unit: BuiltUnit, alter: (values: string) => string): BuiltUnit {
  return {
    ...unit,
    children: unit.children.map((row) =>
      row.table === "sys_hub_flow_logic_instance_v2"
        ? { ...row, fields: { ...row.fields, values: alter(row.fields["values"] ?? "") } }
        : row,
    ),
  };
}
for (const [label, id] of [
  ["approval", "e47d7a531b022ca88a2ff402a3a3d0d1"],
  ["reapproval", "a3423c7421df98a9a2d4418906bd62e6"],
]) {
  const file = `sys_hub_flow_${id}.xml`;
  const built = builtUnitOf(file, readFileSync(join(root, `${label}-built.xml`), "utf8"));
  const captured = builtUnitOf(file, readFileSync(join(root, `${label}-capture.xml`), "utf8"));
  describe(`published native ${label} capture`, () => {
    it("verifies generated variable descriptors and independently proven optional condition inputs", () => {
      expect(publishedCapture(captured)).toBe(true);
      expect(capturedContentAgrees(built, captured, references, [], logicInputs)).toBe(true);
    });
    it("requires independent evidence for added condition inputs", () => {
      expect(capturedContentAgrees(built, captured)).toBe(false);
      expect(
        capturedContentAgrees(
          built,
          captured,
          references,
          [],
          logicInputs.map((row) => ({ ...row, mandatory: "true" })),
        ),
      ).toBe(false);
      expect(
        capturedContentAgrees(
          built,
          captured,
          references,
          [],
          logicInputs.map((row) => ({ ...row, default_value: "unreviewed" })),
        ),
      ).toBe(false);
    });
    for (const [name, alter] of [
      ["scripts", (text: string) => text.replaceAll("global.ACC", "global.UnreviewedACC")],
      [
        "conditions",
        (text: string) =>
          text
            .replaceAll("ISNOTEMPTY", "ISEMPTY")
            .replace(/("name":"condition","value":"[^"]*)rejected/g, "$1unreviewed"),
      ],
      [
        "active script flags",
        (text: string) => text.replaceAll('"scriptActive":false', '"scriptActive":true'),
      ],
      [
        "parameter defaults",
        (text: string) => text.replaceAll('"defaultValue":""', '"defaultValue":"unreviewed"'),
      ],
      ["variable type", (text: string) => text.replaceAll('"type":"string"', '"type":"integer"')],
      [
        "variable size",
        (text: string) =>
          text
            .replaceAll('"maxsize":4000', '"maxsize":1')
            .replaceAll('"maxsize":40', '"maxsize":1'),
      ],
      [
        "unknown parameter keys",
        (text: string) => text.replaceAll('"parameter":{', '"parameter":{"unreviewed":true,'),
      ],
      [
        "nonempty optional conditions",
        (text: string) =>
          text.replaceAll(
            '"name":"condition_name","value":""',
            '"name":"condition_name","value":"changed"',
          ),
      ],
    ] as const) {
      it(`refuses changed ${name}`, () => {
        const altered = changed(captured, alter);
        expect(altered).not.toEqual(captured);
        expect(capturedContentAgrees(built, altered, references, [], logicInputs)).toBe(false);
      });
    }
    if (label === "reapproval") {
      for (const [name, before, after] of [
        ["record input", "{{subflow.ritm}}", "{{subflow.other}}"],
        ["level input", '"value":"1"', '"value":"4"'],
        ["level representation", '"value":"1"', '"value":"01"'],
      ] as const)
        it(`refuses a changed subflow ${name}`, () => {
          const altered = {
            ...captured,
            children: captured.children.map((row) =>
              row.table === "sys_hub_sub_flow_instance_v2"
                ? {
                    ...row,
                    fields: {
                      ...row.fields,
                      subflow_inputs: (row.fields["subflow_inputs"] ?? "").replaceAll(
                        before,
                        after,
                      ),
                    },
                  }
                : row,
            ),
          };
          expect(altered).not.toEqual(captured);
          expect(capturedContentAgrees(built, altered, references, [], logicInputs)).toBe(false);
        });
      it("requires a proven snapshot-to-subflow identity", () => {
        expect(capturedContentAgrees(built, captured, new Map(), [], logicInputs)).toBe(false);
        expect(
          capturedContentAgrees(
            built,
            captured,
            new Map([["4874a9d2836817102e6494b6feaad315", "other"]]),
            [],
            logicInputs,
          ),
        ).toBe(false);
      });
    }
    it("refuses duplicate variable assignments", () => {
      const altered = changed(captured, (text) => {
        if (!text) return text;
        const value: Record<string, unknown> = JSON.parse(text);
        const variables = value["variables"];
        if (Array.isArray(variables) && variables.length)
          value["variables"] = [...variables, variables[0]];
        return JSON.stringify(value);
      });
      expect(capturedContentAgrees(built, altered, references, [], logicInputs)).toBe(false);
    });
  });
}
