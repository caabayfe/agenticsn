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

  it("names a menu the SDK would show in the browser, which it can't define for mobile", () => {
    expect(
      knownRefusal(field("sys_app_application", "device_type", "browser", "mobile")),
    ).toContain("a menu for mobile");
    expect(knownRefusal(field("sys_app_application", "device_type", "browser", ""))).toContain(
      "a menu with no device type",
    );
    expect(
      knownRefusal(field("sys_app_application", "device_type", "browser", "browser")),
    ).toBeNull();
  });

  it("names an advanced ACL with no script, which the SDK would write as not advanced", () => {
    expect(knownRefusal(field("sys_security_acl", "advanced", "false", "true"))).toContain(
      "an advanced ACL with no script",
    );
    expect(knownRefusal(field("sys_security_acl", "advanced", "true", "false"))).toBeNull();
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

  it("names a protected UI action whose roles or views the SDK would change", () => {
    expect(knownRefusal(field("sys_ui_action_role", "sys_policy", "read", ""))).toContain(
      "a protected UI action",
    );
    expect(knownRefusal(field("sys_ui_action_view", "sys_policy", "read", ""))).toContain(
      "a protected UI action",
    );
  });

  it.each([
    [`Type '"read-only"' is not assignable to type '"read" | "protected"'.`, "legacy"],
    [`Type '"private"' is not assignable to type '"public" | "package_private"'.`, "legacy"],
    [
      "workspace.showFormButtonV2 or workspace.showFormMenuButtonV2 must be true when workspace",
      "workspace",
    ],
  ])("names a conversion the SDK can't make: %p", (message, expected) => {
    expect(conversionRefusal(`the converted source does not build: ${message}`)).toContain(
      expected,
    );
  });

  it("names a column of a baseline table, which the SDK's Table can't define in global", () => {
    expect(
      conversionRefusal(
        "the converted source does not build: Global table 'name' property should start with custom prefix 'u_'",
      ),
    ).toContain("a column of a baseline table");
  });

  it("names the legacy protection value read_only too", () => {
    expect(
      conversionRefusal(`Type '"read_only"' is not assignable to type '"read" | "protected"'.`),
    ).toContain("legacy");
  });

  it("names an empty number field without assuming it is a UI policy", () => {
    expect(conversionRefusal("Cannot coerce value to number: ")).toContain("a number field");
  });

  it("names a choice set of a table its application owns: adopt the column", () => {
    expect(
      conversionRefusal(
        "the converted source does not build: ChoiceSet on table 'x_2222332_s11_e2e' is not allowed from scoped app 'x_2222332_s11'",
      ),
    ).toContain("adopt the column");
  });
});
