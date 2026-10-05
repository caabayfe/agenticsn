import { describe, expect, it } from "bun:test";
import { canonicalJson, canonicalText } from "@snagentic/core";

describe("canonicalText", () => {
  it("converts CRLF and lone CR to LF", () => {
    expect(canonicalText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("strips every trailing LF and nothing else", () => {
    expect(canonicalText("a  \n\n\r\n")).toBe("a  ");
  });

  it("keeps leading newlines and inner blank lines", () => {
    expect(canonicalText("\n\na\n\nb")).toBe("\n\na\n\nb");
  });

  it("treats null as the empty string", () => {
    expect(canonicalText(null)).toBe("");
  });
});

describe("canonicalJson", () => {
  it("writes no whitespace between tokens", () => {
    expect(canonicalJson({ b: [1, 2], a: { c: null, d: true } })).toBe(
      '{"a":{"c":null,"d":true},"b":[1,2]}',
    );
  });

  it("escapes non-ASCII characters as lowercase \\u escapes", () => {
    expect(canonicalJson("Café")).toBe('"Caf\\u00e9"');
  });

  it("escapes characters outside the Basic Multilingual Plane as surrogate pairs", () => {
    expect(canonicalJson("😀")).toBe('"\\ud83d\\ude00"');
  });

  it("escapes control characters the way Python does", () => {
    expect(canonicalJson("\n\t\r\b\f\u0001\u001f")).toBe('"\\n\\t\\r\\b\\f\\u0001\\u001f"');
  });

  it("escapes DEL, which JSON.stringify leaves as is", () => {
    expect(canonicalJson("\u007f")).toBe('"\\u007f"');
  });

  it("escapes quotes and backslashes but not forward slashes", () => {
    expect(canonicalJson('a"b\\c/d')).toBe('"a\\"b\\\\c/d"');
  });

  it("escapes lone surrogates", () => {
    expect(canonicalJson("\udc80")).toBe('"\\udc80"');
  });

  it("sorts keys by Unicode code point, not UTF-16 code unit", () => {
    // U+FFFD sorts before U+1F600 by code point, but after it by UTF-16 code unit.
    expect(canonicalJson({ "😀": 1, "�": 2 })).toBe('{"\\ufffd":2,"\\ud83d\\ude00":1}');
  });

  it("keeps a key named __proto__ as ordinary data", () => {
    expect(canonicalJson(JSON.parse('{"__proto__":"x","a":"y"}'))).toBe(
      '{"__proto__":"x","a":"y"}',
    );
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects the non-integer number %p, whose text differs between Python and JavaScript",
    (value) => {
      expect(() => canonicalJson(value)).toThrow();
    },
  );
});
