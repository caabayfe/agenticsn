import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BuiltUnit, capturedContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi12-catalog-trigger-2026-11-16",
);
const name = "sys_hub_flow_dc3159a909ded6793ee4603e8b142b6f.xml";
const built = builtUnitOf(name, readFileSync(join(root, "built.xml"), "utf8"));
const actual = builtUnitOf(name, readFileSync(join(root, "capture.xml"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "native-contract.json"), "utf8"));
const references = new Map([
  ["4874a9d2836817102e6494b6feaad315", "e47d7a531b022ca88a2ff402a3a3d0d1"],
]);
const agrees = (unit = actual, contracts = [contract]) =>
  capturedContentAgrees(built, unit, references, contracts);
function field(table: string, patch: Record<string, string>): BuiltUnit {
  return {
    ...actual,
    children: actual.children.map((row) =>
      row.table === table && row.fields["model"] !== actual.head.fields["master_snapshot"]
        ? { ...row, fields: { ...row.fields, ...patch } }
        : row,
    ),
  };
}
function input(name: string, patch: Record<string, unknown>): BuiltUnit {
  return {
    ...actual,
    children: actual.children.map((row) => {
      if (
        row.table !== "sys_hub_action_instance_v2" ||
        !built.children.some((wanted) => wanted.sysId === row.sysId)
      )
        return row;
      const values: Record<string, unknown>[] = JSON.parse(row.fields["values"] ?? "[]");
      return {
        ...row,
        fields: {
          ...row.fields,
          values: JSON.stringify(
            values.map((entry) => (entry["name"] === name ? { ...entry, ...patch } : entry)),
          ),
        },
      };
    }),
  };
}

describe("published native Service Catalog capture", () => {
  it("verifies projected catalog inputs and native optional action defaults", () => {
    expect(publishedCapture(actual)).toBe(true);
    expect(agrees()).toBe(true);
    expect(agrees(actual, [])).toBe(false);
    expect(agrees(actual, [{ ...contract, actionInputs: [] }])).toBe(false);
    expect(agrees(actual, [{ ...contract, logicInputs: [] }])).toBe(false);
  });
  for (const patch of [
    { model: "other" },
    { internal_type: "string" },
    { reference: "incident" },
    { default_value: "changed" },
    { calculation: "return 'changed';" },
  ])
    it(`refuses changed catalog input ${Object.keys(patch)[0]}`, () =>
      expect(agrees(field("sys_hub_flow_input", patch))).toBe(false));
  for (const patch of [
    { catalog_item: "other" },
    { run_flow_in: "foreground" },
    { active: "false" },
    { published_version: "other" },
  ])
    it(`refuses changed runtime ${Object.keys(patch)[0]}`, () =>
      expect(agrees(field("sys_flow_catalog_trigger", patch))).toBe(false));
  it("refuses missing, duplicated and deleted generated records", () => {
    for (const table of ["sys_flow_catalog_trigger", "sys_hub_flow_input"]) {
      const row = actual.children.find(
        (row) =>
          row.table === table &&
          (table !== "sys_hub_flow_input" || row.fields["model"] === actual.head.sysId),
      );
      if (!row) throw new Error("missing fixture row");
      expect(
        agrees({ ...actual, children: actual.children.filter((value) => value !== row) }),
      ).toBe(false);
      expect(
        agrees({ ...actual, children: [...actual.children, { ...row, sysId: "duplicate" }] }),
      ).toBe(false);
      expect(
        agrees({
          ...actual,
          children: actual.children.map((value) =>
            value === row ? { ...row, action: "DELETE" as const } : value,
          ),
        }),
      ).toBe(false);
    }
  });
  for (const [name, patch] of [
    ["ah_wait", { value: "0" }],
    ["ah_wait", { value: "01" }],
    ["max_results", { value: "1001" }],
    ["sort_type", { value: "sort_desc" }],
    ["sort_type", { displayValue: "unreviewed" }],
    ["ah_fields", { value: "state=3" }],
    ["catalog_variables", { scriptActive: true }],
  ] as const)
    it(`refuses changed ${name}: ${JSON.stringify(patch)}`, () =>
      expect(agrees(input(name, patch))).toBe(false));
  for (const patch of [
    { unreviewed: true },
    { table: "incident" },
    { reference: "incident" },
    { maxsize: 1 },
    { readOnly: true },
    { attributes: { unreviewed: "true" } },
  ])
    it(`refuses changed generated records parameter ${Object.keys(patch)[0]}`, () => {
      const altered = {
        ...actual,
        children: actual.children.map((row) => {
          if (
            row.table !== "sys_hub_flow_logic_instance_v2" ||
            !built.children.some((wanted) => wanted.sysId === row.sysId)
          )
            return row;
          const values = JSON.parse(row.fields["values"] ?? "{}");
          if (!Array.isArray(values.inputs)) return row;
          for (const entry of values.inputs.filter(
            (entry: Record<string, unknown>) => entry["name"] === "items",
          ))
            Object.assign(entry.parameter, patch);
          return { ...row, fields: { ...row.fields, values: JSON.stringify(values) } };
        }),
      };
      expect(agrees(altered)).toBe(false);
    });
  it("requires independently matching native parameter identities", () => {
    expect(
      agrees(actual, [
        {
          ...contract,
          actionInputs: contract.actionInputs.map((row: Record<string, string>) => ({
            ...row,
            sys_id: "other",
          })),
        },
      ]),
    ).toBe(false);
    expect(
      agrees(actual, [
        {
          ...contract,
          outputs: contract.outputs.map((row: Record<string, string>) => ({
            ...row,
            reference: "incident",
          })),
        },
      ]),
    ).toBe(false);
  });
});
