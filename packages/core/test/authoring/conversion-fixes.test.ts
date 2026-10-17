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
