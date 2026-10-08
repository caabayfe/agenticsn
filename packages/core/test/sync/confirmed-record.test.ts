import { describe, expect, it } from "bun:test";
import { instanceConfirms, relocatedRecords } from "@snagentic/core";

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

const stored = (document: unknown, files: { field: string; content: string }[] = []) => ({
  document,
  files,
});

describe("instanceConfirms", () => {
  it("accepts the instance's copy of a record that holds every field set locally", () => {
    expect(instanceConfirms(stored(local), stored(fromInstance))).toBe(true);
  });

  it("rejects a copy where a field set locally has another value", () => {
    const changed = { ...fromInstance, description: "Changed there." };
    expect(instanceConfirms(stored(local), stored(changed))).toBe(false);
  });

  it("rejects a copy missing a field set locally", () => {
    const { description, ...without } = fromInstance;
    expect(description).toBeDefined();
    expect(instanceConfirms(stored(local), stored(without))).toBe(false);
  });

  it("rejects another record: other sys_id, class or scope", () => {
    const meta = fromInstance._meta;
    for (const changed of [
      { ...meta, sys_id: "0123456789abcdef0123456789abcdef" },
      { ...meta, sys_class_name: "sys_script" },
      { ...meta, scope: "x_acme" },
    ]) {
      expect(instanceConfirms(stored(local), stored({ ...fromInstance, _meta: changed }))).toBe(
        false,
      );
    }
  });

  it("treats values the way pull writes them (line endings, trailing newline)", () => {
    const written = { ...local, description: "Line one\r\nLine two\n" };
    const pulled = { ...fromInstance, description: "Line one\nLine two" };
    expect(instanceConfirms(stored(written), stored(pulled))).toBe(true);
  });

  it("compares script and HTML fields too, ignoring a missing trailing newline", () => {
    const html = "<p>Hello</p>";
    expect(
      instanceConfirms(
        stored(local, [{ field: "script", content: "var Util;" }]),
        stored(fromInstance, [{ field: "script", content: "var Util;\n" }]),
      ),
    ).toBe(true);
    expect(
      instanceConfirms(
        stored(local, [{ field: "message_html", content: html }]),
        stored(fromInstance, [{ field: "message_html", content: "<p>Changed</p>\n" }]),
      ),
    ).toBe(false);
  });

  it("ignores fields the instance's copy withholds, such as a property's value", () => {
    const property = {
      _meta: { scope: "global", sys_class_name: "sys_properties", sys_id: SYS_ID },
      name: "u.reminder_minutes",
      type: "integer",
      value: "15",
    };
    const pulled = {
      _meta: { ...property._meta, redacted: ["value"] },
      name: "u.reminder_minutes",
      type: "integer",
      sys_name: "u.reminder_minutes",
    };
    expect(instanceConfirms(stored(property), stored(pulled))).toBe(true);
  });

  it("rejects what is not a record", () => {
    expect(instanceConfirms(stored({ name: "x" }), stored(fromInstance))).toBe(false);
    expect(instanceConfirms(stored(local), stored("not a record"))).toBe(false);
  });
});

describe("relocatedRecords", () => {
  const ID = "0123456789abcdef0123456789abcdef";

  it("pairs a local file with the mirror's file for the same record under another name", () => {
    expect(
      relocatedRecords(
        [`global/sys_db_object/u-escalation--${ID}`, `global/sys_script/other--${"f".repeat(32)}`],
        [`global/sys_db_object/on-call-escalation--${ID}`],
      ),
    ).toEqual([
      {
        local: `global/sys_db_object/u-escalation--${ID}`,
        mirror: `global/sys_db_object/on-call-escalation--${ID}`,
      },
    ]);
  });

  it("pairs only within the same scope and class folder", () => {
    expect(
      relocatedRecords([`global/sys_script/a--${ID}`], [`x_acme/sys_script/b--${ID}`]),
    ).toEqual([]);
  });

  it("ignores files that are not named after a sys_id", () => {
    expect(relocatedRecords(["global/sys_script/a"], ["global/sys_script/b"])).toEqual([]);
  });
});
