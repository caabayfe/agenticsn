import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { capturedContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";
import { decodeCapture } from "../../../src/adapters/fluent/capture-decoder";

const root = join(import.meta.dir, "../../../../../tests/fixtures/p1-delivery/pdi11-2026-11-14");
const capturedUnits = readdirSync(join(root, "captured")).map((file) =>
  builtUnitOf(file, readFileSync(join(root, "captured", file), "utf8")),
);
const references = new Map(
  capturedUnits.flatMap((unit) =>
    unit.children.flatMap((row): [string, string][] => {
      const parent = row.fields["parent_flow"] ?? row.fields["parent_action"];
      return parent === undefined ? [] : [[row.sysId, parent]];
    }),
  ),
);
describe("published captures recorded on pdi11", () => {
  it("verifies a compiled definition deletion without requiring a surviving snapshot", () => {
    for (const unit of capturedUnits) {
      const deletion = {
        ...unit,
        head: { ...unit.head, action: "DELETE" as const, fields: { sys_id: unit.head.sysId } },
        children: [],
      };
      expect(publishedCapture(deletion)).toBe(true);
    }
  });

  for (const file of readdirSync(join(root, "built")).sort()) {
    it(`verifies the authored graph in ${file} alongside its compiled snapshot copies`, () => {
      const built = builtUnitOf(file, readFileSync(join(root, "built", file), "utf8"));
      const captured = decodeCapture(
        built.updateName,
        readFileSync(join(root, "captured", file), "utf8"),
      );
      expect(captured?.published).toBe(true);
      expect(captured !== null && capturedContentAgrees(built, captured.unit, references)).toBe(
        true,
      );
    });

    it(`rejects changed authored rows and missing rows in ${file}`, () => {
      const built = builtUnitOf(file, readFileSync(join(root, "built", file), "utf8"));
      const actual = capturedUnits.find((unit) => unit.updateName === built.updateName);
      if (actual === undefined) throw new Error("fixture missing");
      const row = actual.children.find(
        (held) =>
          built.children.some(
            (wanted) =>
              wanted.sysId !== "" && wanted.sysId === held.sysId && wanted.table === held.table,
          ) &&
          ["value", "values", "subflow_inputs", "trigger_inputs"].some(
            (field) => held.fields[field] !== undefined,
          ),
      );
      if (row === undefined) throw new Error("no authored fixture row");
      const field =
        ["value", "values", "subflow_inputs", "trigger_inputs"].find(
          (field) => row.fields[field] !== undefined,
        ) ?? "value";
      const changed = { ...row, fields: { ...row.fields, [field]: "changed authored content" } };
      expect(
        capturedContentAgrees(
          built,
          { ...actual, children: actual.children.map((held) => (held === row ? changed : held)) },
          references,
        ),
      ).toBe(false);
      expect(
        capturedContentAgrees(
          built,
          { ...actual, children: actual.children.filter((held) => held !== row) },
          references,
        ),
      ).toBe(false);
    });

    it(`requires a published snapshot belonging to the definition in ${file}`, () => {
      const actual = capturedUnits.find((unit) => unit.file === file);
      if (actual === undefined) throw new Error("fixture missing");
      const changed = {
        ...actual,
        children: actual.children.map((row) =>
          row.table.endsWith("snapshot")
            ? { ...row, fields: { ...row.fields, parent_flow: "other", parent_action: "other" } }
            : row,
        ),
      };
      expect(publishedCapture(changed)).toBe(false);
      const field = actual.head.table === "sys_hub_flow" ? "status" : "state";
      expect(
        publishedCapture({
          ...actual,
          head: { ...actual.head, fields: { ...actual.head.fields, [field]: "draft" } },
        }),
      ).toBe(false);
      expect(
        publishedCapture({
          ...actual,
          children: actual.children.map((row) =>
            row.table.endsWith("snapshot")
              ? { ...row, fields: { ...row.fields, master: "false" } }
              : row,
          ),
        }),
      ).toBe(false);
    });
  }
});
