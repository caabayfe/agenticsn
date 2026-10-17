import { describe, expect, it } from "bun:test";
import { knownRefusal } from "@snagentic/core";

const field = (table: string, name: string, built: string, instance: string) => ({
  kind: "field" as const,
  table,
  row: "",
  field: name,
  built,
  instance,
});

// Differences adopt refuses by design, with the reason (product owner, 2026-10-17).
describe("knownRefusal", () => {
  it("names a protected role whose containment rows the SDK would mark read-only", () => {
    expect(knownRefusal(field("sys_user_role_contains", "sys_policy", "read", ""))).toContain(
      "a protected role: the SDK would mark its containment rows read-only",
    );
  });

  it("names nothing for a difference that isn't refused by design", () => {
    expect(knownRefusal(field("sys_user_role", "description", "a", "b"))).toBeNull();
    expect(knownRefusal(field("sys_user_role_contains", "sys_policy", "", "read"))).toBeNull();
  });
});
