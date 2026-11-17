import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capturedContentAgrees, publishedCapture } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi13-record-update-2026-11-17",
);
const built = JSON.parse(readFileSync(join(root, "built.json"), "utf8"));
const native = JSON.parse(readFileSync(join(root, "native.json"), "utf8"));
const capture = builtUnitOf(
  `${built.updateName}.xml`,
  readFileSync(join(root, "capture.xml"), "utf8"),
);
const projected = capture.children.find(
  (r) =>
    r.table === "sys_hub_flow_input" &&
    r.fields["model"] === built.head.sysId &&
    r.fields["element"] === "changed_fields",
);
if (!projected) throw new Error("fixture lacks a projected Changed Fields row");

const agrees = (actual = capture) => capturedContentAgrees(built, actual, new Map(), [native]);

describe("published Record Updated trigger captured on PDI13", () => {
  it("compares the generated Changed Fields output to its native trigger contract", () => {
    expect(publishedCapture(capture)).toBe(true);
    expect(agrees()).toBe(true);
  });

  it("fails closed without native output evidence", () => {
    expect(capturedContentAgrees(built, capture, new Map(), [], native.logicInputs)).toBe(false);
  });

  for (const field of [
    "internal_type",
    "default_value",
    "calculation",
    "model",
    "model_id",
    "model_table",
    "name",
  ] as const) {
    it(`rejects a changed ${field} on the projected output`, () => {
      const children = capture.children.map((row) =>
        row === projected ? { ...row, fields: { ...row.fields, [field]: "unexpected" } } : row,
      );
      expect(agrees({ ...capture, children })).toBe(false);
    });
  }

  it("rejects a missing projected output even with the native contract", () => {
    expect(
      agrees({ ...capture, children: capture.children.filter((row) => row !== projected) }),
    ).toBe(false);
  });

  it("rejects duplicate projected outputs", () => {
    expect(
      agrees({
        ...capture,
        children: [...capture.children, { ...projected, sysId: "f".repeat(32) }],
      }),
    ).toBe(false);
  });
});
