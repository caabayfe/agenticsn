import { describe, expect, it } from "bun:test";
import { type Row, rereadsBetween } from "@snagentic/core";
import { BEFORE, pulledInstance, sid, touch } from "../support/incremental-fixture";

const prop = (n: number, name: string, type: string, value: string, isPrivate = "false"): Row => ({
  sys_id: sid(n),
  sys_class_name: "sys_properties",
  name,
  type,
  value,
  is_private: isPrivate,
  sys_scope: "global",
  sys_updated_on: BEFORE,
});

const path = (slug: string, n: number) => `global/sys_properties/${slug}--${sid(n)}.yaml`;
const MODE = path("acme-inbound-active", 30);
const TOKEN = path("acme-endpoint", 31);

function withProperties(tables: Record<string, Row[]>): void {
  tables["sys_db_object"]?.push({ sys_id: "c8", name: "sys_properties", super_class: "c0" });
  tables["sys_properties"] = [
    prop(30, "acme.inbound.active", "boolean", "true"),
    prop(31, "acme.endpoint", "string", "https://example.test/?token=abc"),
    prop(32, "acme.retries", "integer", "three"),
  ];
}

const text = (value: unknown) => JSON.stringify(value);

describe("pull: property values (ADR-0034)", () => {
  it("keeps a boolean property's value and redacts a string property's", async () => {
    const { files } = await pulledInstance(withProperties);
    expect(files.get(MODE)).toMatchObject({ value: "true" });
    expect(text(files.get(TOKEN))).not.toContain("example.test");
  });

  it("counts the values redacted for not having their type's shape", async () => {
    const { full } = await pulledInstance(withProperties);
    expect(full.malformedValues).toBe(1);
  });

  it("counts a malformed value downloaded by an incremental pull", async () => {
    const { incremental, tables } = await pulledInstance(withProperties);
    touch(tables["sys_properties"]?.[0], { value: "maybe" });
    const { summary } = await incremental();
    expect(summary.malformedValues).toBe(1);
  });

  it("re-reads properties and lists choices again when the redaction policy changed", async () => {
    const { incremental, state } = await pulledInstance(withProperties);
    if (state.saved.state !== null) {
      state.saved.state = { ...state.saved.state, redactionVersion: 1 };
    }
    const { summary, queries } = await incremental();
    expect(summary.rereadForRedaction).toEqual(["sys_properties", "sys_choice"]);
    expect(queries.some((q) => q.query.startsWith("sys_class_name=sys_properties"))).toBe(true);
    expect(queries.some((q) => String(q.table) === "sys_choice")).toBe(true);
    expect(summary.next.redactionVersion).toBe(2);
  });

  it("does not re-read them on the next pull", async () => {
    const { incremental, state } = await pulledInstance(withProperties);
    if (state.saved.state !== null) {
      state.saved.state = { ...state.saved.state, redactionVersion: 1 };
    }
    const first = await incremental();
    state.saved.state = first.summary.next;
    const { summary, queries } = await incremental();
    expect(summary.rereadForRedaction).toEqual([]);
    expect(queries).toEqual([]);
  });

  it("treats a mirror pulled before redaction versions as version 1", async () => {
    const { incremental, state } = await pulledInstance(withProperties);
    if (state.saved.state !== null) {
      const { redactionVersion: _old, ...older } = state.saved.state;
      state.saved.state = older;
    }
    const { summary } = await incremental();
    expect(summary.rereadForRedaction).toEqual(["sys_properties", "sys_choice"]);
  });

  it("names properties as unreadable when the user may not read them during the re-read", async () => {
    const { incremental, state, deny } = await pulledInstance(withProperties);
    if (state.saved.state !== null) {
      state.saved.state = { ...state.saved.state, redactionVersion: 1 };
    }
    deny("sys_properties");
    const { summary } = await incremental();
    expect(summary.unreadable).toContain("sys_properties");
    expect(summary.next.redactionVersion).toBe(2);
  });

  it("records the policy version a full pull applied", async () => {
    const { full } = await pulledInstance(withProperties);
    expect(full.next.redactionVersion).toBe(2);
  });
});

describe("rereadsBetween", () => {
  it("names what changed in every version after the mirror's", () => {
    expect(rereadsBetween(1, 2)).toEqual({
      classes: ["sys_properties"],
      childTables: ["sys_choice"],
    });
  });

  it("names nothing when the versions match", () => {
    expect(rereadsBetween(2, 2)).toEqual({ classes: [], childTables: [] });
  });
});
