import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capturedContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi12-approval-2026-11-16",
);
const name = "sys_hub_flow_d2c69d6476b9c20cf69f5d332f6519ca.xml";
const built = builtUnitOf(name, readFileSync(join(root, "built.xml"), "utf8"));
const captured = builtUnitOf(name, readFileSync(join(root, "capture.xml"), "utf8"));

function changedInput(name: string) {
  return {
    ...captured,
    children: captured.children.map((row) => {
      if (
        row.table !== "sys_hub_action_instance_v2" ||
        !built.children.some((r) => r.sysId === row.sysId)
      )
        return row;
      const values: Record<string, unknown>[] = JSON.parse(row.fields["values"] ?? "[]");
      return {
        ...row,
        fields: {
          ...row.fields,
          values: JSON.stringify(
            values.map((v) => (v["name"] === name ? { ...v, value: "changed" } : v)),
          ),
        },
      };
    }),
  };
}

describe("published approval capture recorded on pdi12", () => {
  it("verifies native blank display labels for computed record and relative deadline inputs", () => {
    expect(publishedCapture(captured)).toBe(true);
    expect(capturedContentAgrees(built, captured)).toBe(true);
  });
  for (const input of ["record", "due_date", "approval_conditions", "approval_reason"]) {
    it(`refuses a changed ${input} in the published approval`, () => {
      expect(capturedContentAgrees(built, changedInput(input))).toBe(false);
    });
  }
});
