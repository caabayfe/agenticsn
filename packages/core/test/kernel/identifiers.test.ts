import { describe, expect, it } from "bun:test";
import { InvalidIdentifierError, ScopeName, SysId, TableName } from "@snagentic/core";

describe("SysId", () => {
  it("accepts a 32-character hexadecimal id", () => {
    expect(SysId.parse("0123456789abcdef0123456789abcdef")).toBe(
      SysId.parse("0123456789abcdef0123456789abcdef"),
    );
  });

  it.each(["sysverb_query", "Default view", "inbox", "2", "a".repeat(64)])(
    "accepts the legacy out-of-box id %p",
    (value) => {
      expect(SysId.is(value)).toBe(true);
    },
  );

  it.each(["", " leading", "trailing ", "a/b", "a.b", "a".repeat(65), "tab\there"])(
    "rejects %p",
    (value) => {
      expect(SysId.is(value)).toBe(false);
    },
  );

  it("raises InvalidIdentifierError with code invalid-sys-id", () => {
    expect(() => SysId.parse("a/b")).toThrow(InvalidIdentifierError);
    try {
      SysId.parse("a/b");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdentifierError);
      expect((error as InvalidIdentifierError).code).toBe("invalid-sys-id");
    }
  });
});

describe("TableName", () => {
  it.each(["incident", "sys_script_include", "$table", "u_table2"])("accepts %p", (value) => {
    expect(TableName.is(value)).toBe(true);
  });

  it.each(["Incident", "sys script", "a/b", "", "a.b"])("rejects %p", (value) => {
    expect(TableName.is(value)).toBe(false);
  });

  it("returns the validated name from parse", () => {
    expect(TableName.parse("sys_script")).toBe("sys_script" as TableName);
  });

  it("raises InvalidIdentifierError with code invalid-table-name", () => {
    expect(() => TableName.parse("Bad Name")).toThrow(InvalidIdentifierError);
  });
});

describe("ScopeName", () => {
  it.each(["global", "x_acme_app", "sn.custom", "$scope", "my-app"])(
    "keeps the safe name %p",
    (value) => {
      expect(ScopeName.fromInstance(value)).toBe(value as ScopeName);
    },
  );

  it("trims surrounding whitespace", () => {
    expect(ScopeName.fromInstance("  x_acme  ")).toBe("x_acme" as ScopeName);
  });

  it("trims whitespace exactly like v1 (Python), including \\x1f and \\x85 but not \\ufeff", () => {
    expect(ScopeName.fromInstance("\x1fx_acme\x85")).toBe("x_acme" as ScopeName);
    expect(ScopeName.fromInstance("\ufeffx_acme")).toBe("x-acme" as ScopeName);
  });

  it("converts unsafe names to a slug instead of failing", () => {
    expect(ScopeName.fromInstance("Acme Corp/App")).toBe("acme-corp-app" as ScopeName);
  });

  it.each([null, "", "   "])("maps the empty scope %p to global", (value) => {
    expect(ScopeName.fromInstance(value)).toBe("global" as ScopeName);
  });

  it.each([".", "..", "@@@", "/"])("never returns a dangerous path segment for %p", (value) => {
    const scope = ScopeName.fromInstance(value);
    expect([".", ".."]).not.toContain(scope);
    expect(scope).not.toMatch(/[/\\]/);
    expect(scope.length).toBeGreaterThan(0);
  });
});
