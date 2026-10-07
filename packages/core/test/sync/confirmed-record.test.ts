import { describe, expect, it } from "bun:test";
import { instanceConfirms } from "@snagentic/core";

const SYS_ID = "4944d956393ce479c7b489974061fefd";

// A record as an agent writes it before pushing: identity and the fields it sets.
const local = {
  _meta: { scope: "global", sys_class_name: "sys_script_include", sys_id: SYS_ID },
  active: "false",
  description: "Inactive test record.",
  name: "SnagenticLiveTest",
};

// The same record as pull writes it after the push: what the platform filled in, too.
const fromInstance = {
  _meta: {
    hash: "5afc6e77",
    hash_version: 1,
    scope: "global",
    sys_class_name: "sys_script_include",
    sys_created_on: "2026-10-07 19:43:30",
    sys_id: SYS_ID,
    sys_mod_count: "0",
  },
  access: "package_private",
  active: "false",
  api_name: "global.SnagenticLiveTest",
  description: "Inactive test record.",
  name: "SnagenticLiveTest",
  sys_name: "SnagenticLiveTest",
};

describe("instanceConfirms", () => {
  it("accepts the instance's copy of a record that holds every field set locally", () => {
    expect(instanceConfirms(local, fromInstance)).toBe(true);
  });

  it("rejects a copy where a field set locally has another value", () => {
    expect(instanceConfirms(local, { ...fromInstance, description: "Changed there." })).toBe(false);
  });

  it("rejects a copy missing a field set locally", () => {
    const { description, ...without } = fromInstance;
    expect(description).toBeDefined();
    expect(instanceConfirms(local, without)).toBe(false);
  });

  it("rejects another record: other sys_id, class or scope", () => {
    const meta = fromInstance._meta;
    for (const changed of [
      { ...meta, sys_id: "0123456789abcdef0123456789abcdef" },
      { ...meta, sys_class_name: "sys_script" },
      { ...meta, scope: "x_acme" },
    ]) {
      expect(instanceConfirms(local, { ...fromInstance, _meta: changed })).toBe(false);
    }
  });

  it("treats values the way pull writes them (line endings, trailing newline)", () => {
    const written = { ...local, description: "Line one\r\nLine two\n" };
    const pulled = { ...fromInstance, description: "Line one\nLine two" };
    expect(instanceConfirms(written, pulled)).toBe(true);
  });

  it("rejects what is not a record", () => {
    expect(instanceConfirms({ name: "x" }, fromInstance)).toBe(false);
    expect(instanceConfirms(local, "not a record")).toBe(false);
  });
});
