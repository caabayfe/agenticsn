import { describe, expect, it } from "bun:test";
import { BEHAVIOR_CLASSES, behaviorTable, orderOf } from "@snagentic/core";

const phase = (className: string, fields: Record<string, string>) =>
  BEHAVIOR_CLASSES[className]?.phase(fields);

describe("table behavior", () => {
  it("places business rules in their phase", () => {
    expect(phase("sys_script", { when: "before" })).toBe("before");
    expect(phase("sys_script", { when: "after" })).toBe("after");
    expect(phase("sys_script", { when: "async" })).toBe("async");
    expect(phase("sys_script", { when: "display" })).toBe("display");
    // Values as the platform stores them.
    expect(phase("sys_script", { when: "before_display" })).toBe("display");
    expect(phase("sys_script", { when: "async_always" })).toBe("async");
    expect(phase("sys_script", { when: "" })).toBe("before");
    expect(phase("sys_script", { when: "before", action_query: "true" })).toBe("query");
  });

  it("finds the table each kind of record acts on", () => {
    expect(behaviorTable("sys_script", { collection: "incident" })).toBe("incident");
    expect(behaviorTable("sys_script_client", { table: "incident" })).toBe("incident");
    expect(behaviorTable("sys_security_acl", { name: "incident.priority" })).toBe("incident");
    expect(behaviorTable("sys_security_acl", { name: "incident.*" })).toBe("incident");
    expect(behaviorTable("sys_data_policy2", { model_table: "incident" })).toBe("incident");
  });

  it("ignores records that are not table behavior, or name no table", () => {
    expect(behaviorTable("sys_script_include", { name: "Foo" })).toBeNull();
    expect(behaviorTable("sys_script", { collection: "" })).toBeNull();
  });

  it("orders by the order field, empty counting as the platform's default 100", () => {
    expect(orderOf({ order: "50" })).toBe(50);
    expect(orderOf({ order: "" })).toBe(100);
    expect(orderOf({})).toBe(100);
  });
});
