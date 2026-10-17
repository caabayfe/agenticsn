import { describe, expect, it } from "bun:test";
import {
  Catalog,
  DEFAULT_REDACTION,
  fieldsToRedact,
  propertyValueVerdict,
  type Row,
} from "@snagentic/core";
import fc from "fast-check";

const catalog = new Catalog({
  parents: { sys_metadata: null, sys_properties: "sys_metadata" },
  scopes: { global: "global" },
  typedFields: {},
});

const property = (type: string, value: string, extra: Row = {}): Row => ({
  name: "acme.feature.mode",
  type,
  value,
  is_private: "false",
  ...extra,
});

const kept = (row: Row) =>
  !fieldsToRedact(catalog, "sys_properties", row, DEFAULT_REDACTION).has("value");

// ADR-0034: a property's value is kept only for typed, non-private, non-secret properties whose
// value has the shape of its type.
describe("property values (ADR-0034)", () => {
  it.each([
    ["boolean", "true"],
    ["boolean", "false"],
    ["integer", "250"],
    ["integer", "-1"],
    ["choicelist", "round_robin"],
    ["color", "#1f8476"],
    ["date_format", "yyyy-MM-dd"],
    ["time_format", "HH:mm:ss"],
    ["timezone", "Europe/Madrid"],
    ["boolean", ""],
  ])("keeps the value of a %s property (%p)", (type, value) => {
    expect(kept(property(type, value))).toBe(true);
  });

  it.each(["string", "short_string", "password", "password2", "image", "uploaded_image", "html"])(
    "redacts the value of a %s property",
    (type) => {
      expect(kept(property(type, "anything"))).toBe(false);
    },
  );

  it("redacts a private property's value even when it is a boolean", () => {
    expect(kept(property("boolean", "true", { is_private: "true" }))).toBe(false);
  });

  it("redacts a value when the property's privacy is unknown", () => {
    const { is_private: _unknown, ...row } = property("boolean", "true");
    expect(kept(row)).toBe(false);
  });

  it("redacts a value named like a secret even when it is an integer", () => {
    expect(kept(property("integer", "1234", { name: "acme.api_key" }))).toBe(false);
    expect(kept(property("boolean", "true", { name: "acme.client_secret" }))).toBe(false);
  });

  it.each([
    ["integer", "12 or 13"],
    ["integer", "0x1f"],
    ["boolean", "yes"],
    ["choicelist", "two words"],
    ["choicelist", "x".repeat(81)],
    ["timezone", "z".repeat(41)],
    ["date_format", "line\nbreak"],
  ])("redacts a %s property whose value is not shaped like it (%p)", (type, value) => {
    expect(kept(property(type, value))).toBe(false);
    expect(propertyValueVerdict(property(type, value), DEFAULT_REDACTION)).toBe("malformed");
  });

  it("redacts a kept-type value that looks like a credential", () => {
    expect(kept(property("choicelist", "password=hunter22"))).toBe(false);
  });

  it("matches property types exactly", () => {
    expect(kept(property("Boolean", "true"))).toBe(false);
  });

  it("still keeps an allowlisted string property, as before", () => {
    const row = property("string", "x_acme", { name: "glide.appcreator.company.code" });
    expect(kept(row)).toBe(true);
    expect(propertyValueVerdict(row, DEFAULT_REDACTION)).toBe("kept");
  });

  it("names why a value was not kept", () => {
    expect(propertyValueVerdict(property("string", "a"), DEFAULT_REDACTION)).toBe("redacted");
    expect(propertyValueVerdict(property("boolean", "true"), DEFAULT_REDACTION)).toBe("kept");
  });

  it("never keeps a value of a type outside the kept list, whatever it holds", () => {
    const keptTypes = new Set([
      "boolean",
      "integer",
      "choicelist",
      "color",
      "date_format",
      "time_format",
      "timezone",
    ]);
    fc.assert(
      fc.property(
        fc.string().filter((type) => !keptTypes.has(type)),
        fc.string(),
        fc.string(),
        (type, value, name) => !kept(property(type, value, { name: `acme.${name}` })),
      ),
    );
  });

  it("leaves the value field of other classes alone", () => {
    const row = { name: "x", value: "v" };
    expect(fieldsToRedact(catalog, "sys_metadata", row, DEFAULT_REDACTION).has("value")).toBe(
      false,
    );
  });
});
