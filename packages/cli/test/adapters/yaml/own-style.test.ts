import { describe, expect, it } from "bun:test";
import { fromYamlStrings, toYaml } from "../../../src/adapters/yaml/own-style";

// From spike S2: strings that break naive YAML writers. Each must come back unchanged.
const ADVERSARIAL: Record<string, string> = {
  yes: "yes",
  no: "no",
  on: "on",
  off: "Off",
  nullWord: "null",
  tilde: "~",
  empty: "",
  octal: "0123",
  octal12: "0o17",
  hex: "0x1F",
  exponent: "1e3",
  infinity: ".inf",
  date: "2024-01-01",
  timestamp: "2024-01-01 10:00:00",
  leadingSpace: " x",
  trailingSpace: "x ",
  tab: "\tx",
  crlf: "a\r\nb",
  cr: "a\rb",
  trailingNewline: "line\n",
  twoTrailing: "line\n\n",
  onlyNewlines: "\n\n",
  indentedSecondLine: "a\n  b",
  comment: "# x",
  dash: "- x",
  colon: "a: b",
  question: "? x",
  at: "@x",
  backtick: "`x",
  brace: "{x}",
  bracket: "[x]",
  percent: "%x",
  bang: "!x",
  ampersand: "&x",
  star: "*x",
  pipe: "| x",
  greater: "> x",
  quote: "'x\"",
  backslash: "a\\b",
  unicode: "Café 中文",
  emoji: "😀",
  lineSeparator: "a b",
  del: "a\u007fb",
  control: "a\u0001b",
  bom: "﻿x",
  nbsp: "a ",
  long: "x".repeat(500),
  longWords: "word ".repeat(100).trim(),
  spacesOnly: "   ",
  documentEnd: "...",
  documentStart: "---",
};

describe("own YAML style (ADR-0015)", () => {
  it.each(Object.entries(ADVERSARIAL))(
    "round-trips the tricky string %p unchanged",
    (key, value) => {
      expect(fromYamlStrings(toYaml({ [key]: value }))).toEqual({ [key]: value });
    },
  );

  it("covers all 51 strings from spike S2", () => {
    expect(Object.keys(ADVERSARIAL)).toHaveLength(51);
  });

  // Found in the PDI corpus (M2): the library mis-writes whitespace-only lines at the
  // start or end of a multi-line value.
  it.each([
    "/**\n \n* Description: $0\n \n* Parameters: \n \n* Returns:\n*/\n ",
    "Deny delete for records.\n \n ",
    " \n",
    " \nfoo",
    "  \n  indented",
    "\t\nx",
    "\n x",
  ])("round-trips the whitespace-only-line value %p unchanged", (value) => {
    expect(fromYamlStrings(toYaml({ v: value }))).toEqual({ v: value });
  });

  it("keeps literal blocks for ordinary multi-line values", () => {
    expect(toYaml({ v: "a\n \nb" })).toBe("v: |-\n  a\n   \n  b\n");
  });

  it("sorts keys, does not wrap long lines, and writes multi-line values as literal blocks", () => {
    const text = toYaml({
      zeta: "x".repeat(150),
      alpha: "first line\nsecond line",
      _meta: { sys_id: "a" },
    });
    expect(text).toBe(
      `_meta:\n  sys_id: a\nalpha: |-\n  first line\n  second line\nzeta: ${"x".repeat(150)}\n`,
    );
  });

  it("quotes with single quotes only when needed", () => {
    expect(toYaml({ active: "true", count: "5", name: "Plain name" })).toBe(
      "active: 'true'\ncount: '5'\nname: Plain name\n",
    );
  });

  it("reads every scalar as a string, never as a boolean, number or date", () => {
    expect(fromYamlStrings("active: true\ncount: 5\nwhen: 2024-01-01\nnothing: null\n")).toEqual({
      active: "true",
      count: "5",
      when: "2024-01-01",
      nothing: "null",
    });
  });
});
