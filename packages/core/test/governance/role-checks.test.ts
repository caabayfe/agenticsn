import { describe, expect, it } from "bun:test";
import { type BuiltUnit, validate } from "@snagentic/core";
import { roleHits } from "../../src/governance/domain/role-checks";
import { governanceOf } from "../support/fake-governance";

// Spec 009 L8 A6 (pdi2, 2026-10-18): a scoped role containing admin passed every check, so anyone
// granted the application's role became an administrator.

function containment(contains: string, action: "INSERT_OR_UPDATE" | "DELETE" = "INSERT_OR_UPDATE") {
  const id = `${contains.length}`.padStart(32, "c");
  const unit: BuiltUnit = {
    updateName: `sys_user_role_contains_${id}`,
    file: `sys_user_role_contains_${id}.xml`,
    head: {
      table: "sys_user_role_contains",
      sysId: id,
      action,
      fields: { sys_id: id, contains: "a".repeat(32), role: "b".repeat(32) },
      referenceNames: { contains, role: "x_app.superuser" },
    },
    children: [],
  };
  return unit;
}

describe("a role that contains a privileged role (SN-SEC-009)", () => {
  it("flags a containment of admin, security_admin or maint", () => {
    for (const role of ["admin", "security_admin", "maint"]) {
      expect(roleHits(containment(role))).toEqual([
        {
          ruleId: "SN-SEC-009",
          field: "contains",
          message: `x_app.superuser contains ${role}: everyone granted x_app.superuser gets ${role}`,
        },
      ]);
    }
  });

  it("flags it as a child row of a role's unit too", () => {
    const row = containment("admin").head;
    const role: BuiltUnit = {
      updateName: "sys_user_role_x",
      file: "sys_user_role_x.xml",
      head: {
        table: "sys_user_role",
        sysId: "b".repeat(32),
        action: "INSERT_OR_UPDATE",
        fields: { name: "x_app.superuser" },
        referenceNames: {},
      },
      children: [row],
    };
    expect(roleHits(role)).toHaveLength(1);
  });

  it("accepts other roles, and removing a containment", () => {
    expect(roleHits(containment("itil"))).toEqual([]);
    expect(roleHits(containment("admin", "DELETE"))).toEqual([]);
  });

  it("blocks the change in validate", async () => {
    const unit = containment("admin");
    const result = await validate(governanceOf({ "source/x_app": { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.findings.map((f) => [f.ruleId, f.severity])).toContainEqual([
      "SN-SEC-009",
      "block",
    ]);
    expect(result.passed).toBe(false);
  });
});
