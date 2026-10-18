import { describe, expect, it } from "bun:test";
import { fixConverted, knownLoss } from "@snagentic/core";

// Spec 009 X4: what the SDK's conversion writes that its own types reject.
describe("fixConverted", () => {
  it("writes none for a UI policy action's empty message type", () => {
    const text = "{\n            fieldMessageType: '',\n            field: 'state',\n}";
    expect(fixConverted("p.now.ts", text)).toEqual({
      text: "{\n            fieldMessageType: 'none',\n            field: 'state',\n}",
      fixed: ["ui-policy-empty-message-type"],
      refused: [],
    });
  });

  it("refuses a script include whose access is empty, naming what to do", () => {
    const outcome = fixConverted("si.now.ts", "ScriptInclude({\n    accessibleFrom: '',\n})");
    expect(outcome.refused).toEqual([
      expect.stringContaining("si.now.ts: the script include's access is empty"),
    ]);
    expect(outcome.refused[0]).toContain("Accessible from");
  });

  it("refuses roles named by sys_id, which the transform writes for a role it can't read", () => {
    const text =
      "UiAction({\n    roles: ['a8bb6c5f77733110ca60b0b7cf5a9914', 'security_admin'],\n})";
    const outcome = fixConverted("ua.now.ts", text);
    expect(outcome.refused).toEqual([
      expect.stringContaining("ua.now.ts: a role the SDK's conversion couldn't read"),
    ]);
  });

  it("accepts roles named by name", () => {
    const text = "Acl({\n    roles: ['itil', 'x_acme.admin'],\n})";
    expect(fixConverted("acl.now.ts", text).refused).toEqual([]);
  });

  it("leaves source the SDK's types accept as it is", () => {
    const text = "fieldMessageType: 'error',\naccessibleFrom: 'public',";
    expect(fixConverted("p.now.ts", text)).toEqual({ text, fixed: [], refused: [] });
  });
});

describe("knownLoss: empty values the SDK writes as its default", () => {
  const difference = (built: string, instance: string) => ({
    kind: "field" as const,
    table: "sys_ui_policy_action",
    row: "",
    field: "field_message_type",
    built,
    instance,
  });

  it("accepts none where the instance holds an empty message type", () => {
    expect(knownLoss(difference("none", ""))).toBe("api-default");
  });

  it("does not accept a message type the source changed", () => {
    expect(knownLoss(difference("none", "error"))).toBeNull();
  });
});

describe("knownLoss: values the SDK recomputes where the instance holds nothing", () => {
  const field = (table: string, name: string, built: string, instance: string) => ({
    kind: "field" as const,
    table,
    row: "",
    field: name,
    built,
    instance,
  });

  it("accepts a global role's suffix the build sets to its name, where the instance has none", () => {
    expect(knownLoss(field("sys_user_role", "suffix", "itil", ""))).toBe("api-default");
  });

  it("does not accept a role suffix the instance holds", () => {
    expect(knownLoss(field("sys_user_role", "suffix", "pd_shared.admin", "admin"))).toBeNull();
  });

  it("accepts desktop for a UI policy whose UI type is empty", () => {
    expect(knownLoss(field("sys_ui_policy", "ui_type", "0", ""))).toBe("api-default");
  });

  it("does not accept desktop for a UI policy that applies everywhere", () => {
    expect(knownLoss(field("sys_ui_policy", "ui_type", "0", "10"))).toBeNull();
  });

  it("accepts record_action for an inbound action whose type is empty, as the SDK reads it", () => {
    expect(knownLoss(field("sysevent_in_email_action", "action", "record_action", ""))).toBe(
      "api-default",
    );
  });

  it("accepts order 100 for a menu whose order is empty, named in every plan", () => {
    expect(knownLoss(field("sys_app_application", "order", "100", ""))).toBe("api-default");
  });

  it("does not accept 100 for a menu that holds another order", () => {
    expect(knownLoss(field("sys_app_application", "order", "100", "50"))).toBeNull();
  });

  it("accepts the SDK's empty condition function where a UI policy has no script", () => {
    const empty = "function onCondition() {\n\n}";
    expect(knownLoss(field("sys_ui_policy", "script_true", empty, ""))).toBe("api-default");
    expect(knownLoss(field("sys_ui_policy", "script_false", empty, ""))).toBe("api-default");
    expect(knownLoss(field("sys_ui_policy", "script_true", "doThings();", ""))).toBeNull();
  });

  it("accepts ignore for a policy action whose visibility is empty", () => {
    expect(knownLoss(field("sys_ui_policy_action", "visible", "ignore", ""))).toBe("api-default");
    expect(knownLoss(field("sys_ui_policy_action", "visible", "true", ""))).toBeNull();
  });

  it("accepts the policy's table for a policy action whose table is empty", () => {
    expect(knownLoss(field("sys_ui_policy_action", "table", "sys_dictionary", ""))).toBe(
      "api-default",
    );
    expect(knownLoss(field("sys_ui_policy_action", "table", "incident", "task"))).toBeNull();
  });

  it("accepts order 100 for a UI action whose order is empty", () => {
    expect(knownLoss(field("sys_ui_action", "order", "100", ""))).toBe("api-default");
  });

  it("accepts public for a global table whose access is empty, only in global", () => {
    const access = field("sys_db_object", "access", "public", "");
    expect(knownLoss(access, "global")).toBe("api-default");
    expect(knownLoss(access, "x_acme_app")).toBeNull();
    expect(knownLoss(access)).toBeNull();
  });

  it("accepts an empty choice where a column says 0, no choices", () => {
    expect(knownLoss(field("sys_dictionary", "choice", "", "0"))).toBe("api-default");
    expect(knownLoss(field("sys_dictionary", "choice", "", "1"))).toBeNull();
  });
});
