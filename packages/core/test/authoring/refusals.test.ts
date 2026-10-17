import { describe, expect, it } from "bun:test";
import { conversionRefusal, knownRefusal } from "@snagentic/core";

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
      "a protected role: the SDK would change its containment rows' protection from none to read",
    );
  });

  it("names nothing for a difference that isn't refused by design", () => {
    expect(knownRefusal(field("sys_user_role", "description", "a", "b"))).toBeNull();
    expect(knownRefusal(field("sys_user_role_contains", "sys_policy", "read", "read"))).toBeNull();
  });

  it("names a UI policy the SDK would limit to desktop because it runs no scripts", () => {
    expect(knownRefusal(field("sys_ui_policy", "ui_type", "0", "10"))).toContain(
      "would apply only on desktop",
    );
    expect(knownRefusal(field("sys_ui_policy", "ui_type", "0", ""))).toBeNull();
  });

  it("names a protected UI policy whose actions the SDK would mark read-only", () => {
    expect(knownRefusal(field("sys_ui_policy_action", "sys_policy", "read", ""))).toContain(
      "a protected UI policy",
    );
  });

  it("names a conversion the SDK can't make: a number field left empty", () => {
    expect(conversionRefusal("Cannot coerce value to number: ")).toContain("UI type");
    expect(conversionRefusal("Record not found")).toBeNull();
  });

  it("names a protection the SDK would remove from a policy action", () => {
    expect(knownRefusal(field("sys_ui_policy_action", "sys_policy", "", "read"))).toContain(
      "from read to none",
    );
  });

  it("names a UI policy with no short description, which the SDK requires", () => {
    expect(
      conversionRefusal(
        "the converted source does not build: shortDescription cannot be empty or contain only whitespace",
      ),
    ).toContain("short description");
  });
});
