import { describe, expect, it } from "bun:test";
import { type BuiltUnit, validate } from "@snagentic/core";
import { serializedObjectHits } from "../../src/governance/domain/built-values";
import { governanceOf } from "../support/fake-governance";

// pdi2, 2026-10-18 (spec 009 L8 A7): Record({ table: 'sys_app_module', data: { roles: [agent] } })
// with a Role object built roles as '[object Object]'. Build and instance agreed, so plan saw
// nothing, and the modules required a role nobody holds.

function moduleUnit(roles: string, children: BuiltUnit["children"] = []): BuiltUnit {
  const id = "a".repeat(32);
  return {
    updateName: `sys_app_module_${id}`,
    file: `sys_app_module_${id}.xml`,
    head: {
      table: "sys_app_module",
      sysId: id,
      action: "INSERT_OR_UPDATE",
      fields: { sys_id: id, title: "All requests", roles },
      referenceNames: {},
    },
    children,
  };
}

describe("a built value the SDK stringified from an object (SN-MNT-019)", () => {
  it("flags a field holding [object Object], in the head or a row", () => {
    expect(serializedObjectHits(moduleUnit("[object Object]"))).toEqual([
      {
        ruleId: "SN-MNT-019",
        field: "roles",
        message:
          "sys_app_module.roles is built as '[object Object]': the SDK wrote an object where the instance needs text; write the value itself (a role's name, a record's sys_id)",
      },
    ]);
    const row = {
      ...moduleUnit("x").head,
      table: "sys_ui_action_role",
      fields: { role: "itil,[object Object]" },
    };
    expect(serializedObjectHits(moduleUnit("x_app.agent", [row]))).toHaveLength(1);
  });

  it("accepts ordinary values, and scripts that compare with the string", () => {
    expect(serializedObjectHits(moduleUnit("x_app.agent,itil"))).toEqual([]);
    const script = "if (Object.prototype.toString.call(x) === '[object Object]') return x;";
    expect(serializedObjectHits(moduleUnit(script))).toEqual([]);
  });

  it("blocks the change in validate", async () => {
    const result = await validate(
      governanceOf({ "source/x_app": { now: [moduleUnit("[object Object]")], base: [] } }),
      { base: "HEAD" },
    );
    expect(result.findings.map((f) => [f.ruleId, f.severity])).toContainEqual([
      "SN-MNT-019",
      "block",
    ]);
  });
});
