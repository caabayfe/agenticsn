import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capturedContentAgrees } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

const root = join(
  import.meta.dir,
  "../../../../../tests/fixtures/p1-delivery/pdi12-catalog-item-2026-11-16",
);
const name = "sc_cat_item_c0c487e863d9c8636cc259625f46edc0.xml";
const built = builtUnitOf(name, readFileSync(join(root, "built.xml"), "utf8"));
const actual = builtUnitOf(name, readFileSync(join(root, "capture.xml"), "utf8"));
describe("native catalog-item capture defaults", () => {
  it("recognizes only the omitted empty SDK view default", () =>
    expect(capturedContentAgrees(built, actual)).toBe(true));
  it("requires evidence for a nonempty authored view", () =>
    expect(
      capturedContentAgrees(
        { ...built, head: { ...built.head, fields: { ...built.head.fields, view: "unreviewed" } } },
        actual,
      ),
    ).toBe(false));
  it("refuses an unexpected captured view", () =>
    expect(
      capturedContentAgrees(built, {
        ...actual,
        head: { ...actual.head, fields: { ...actual.head.fields, view: "unreviewed" } },
      }),
    ).toBe(false));
  for (const field of ["active", "name", "flow_designer_flow", "description"]) {
    it(`refuses a missing authored ${field}`, () => {
      const fields = Object.fromEntries(
        Object.entries(actual.head.fields).filter(([key]) => key !== field),
      );
      expect(capturedContentAgrees(built, { ...actual, head: { ...actual.head, fields } })).toBe(
        false,
      );
    });
    it(`refuses a changed authored ${field}`, () =>
      expect(
        capturedContentAgrees(built, {
          ...actual,
          head: { ...actual.head, fields: { ...actual.head.fields, [field]: "unreviewed" } },
        }),
      ).toBe(false));
  }
});
