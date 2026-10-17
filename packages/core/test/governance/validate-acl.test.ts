import { describe, expect, it } from "bun:test";
import { type BuiltUnit, validate } from "@snagentic/core";
import { governanceOf, unitOf } from "../support/fake-governance";

// ACL checks on built units: roles are the build's sys_security_acl_role units, and a deletion is
// a Now.del naming the ACL's keys.

const PROJECT = "source/global";
const ACL_ID = "a1c0".padEnd(32, "0");
const RULE_IDS = (result: Awaited<ReturnType<typeof validate>>) =>
  result.findings.map((f) => f.ruleId);

const acl = (fields: Record<string, string>): BuiltUnit =>
  unitOf(
    "sys_security_acl",
    {
      active: "true",
      admin_overrides: "true",
      advanced: "false",
      condition: "",
      decision_type: "allow",
      name: "incident",
      operation: "write",
      script: "",
      security_attribute: "",
      ...fields,
    },
    ACL_ID,
  );

const role = (id: string) =>
  unitOf("sys_security_acl_role", { sys_security_acl: ACL_ID, sys_user_role: "itil" }, id);

const deletion: BuiltUnit = {
  updateName: `sys_security_acl_${"d".repeat(32)}`,
  file: `sys_security_acl_${"d".repeat(32)}.xml`,
  head: {
    table: "sys_security_acl",
    sysId: "d".repeat(32),
    action: "DELETE",
    fields: { sys_id: "d".repeat(32), name: "incident", operation: "read" },
    referenceNames: {},
  },
  children: [],
};

const run = (now: readonly BuiltUnit[], base: readonly BuiltUnit[] = []) =>
  validate(governanceOf({ [PROJECT]: { now, base } }), { base: "HEAD" });

describe("validate: ACL units", () => {
  it("blocks a new write ACL that no role, condition or script restricts", async () => {
    const result = await run([acl({})]);
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-SEC-006",
        severity: "block",
        path: `${PROJECT}/sys_security_acl_${ACL_ID}`,
        message: "the write ACL incident has no role, condition or script, so it restricts nothing",
      }),
    ]);
  });

  it("passes it once a role unit names it", async () => {
    expect((await run([acl({}), role("r".repeat(32))])).findings).toEqual([]);
  });

  it("blocks removing the last role of a write ACL", async () => {
    const result = await run([acl({ description: "d" })], [acl({}), role("r".repeat(32))]);
    expect(RULE_IDS(result)).toEqual(["SN-SEC-006"]);
  });

  it("does not report an unrestricted ACL the change did not open", async () => {
    expect((await run([acl({ description: "d" })], [acl({})])).findings).toEqual([]);
  });

  it("counts roles only for ACLs nothing else restricts", async () => {
    for (const fields of [
      { condition: "active=true" },
      { advanced: "true", script: "answer = gs.hasRole('itil');" },
      { security_attribute: "239bdf0c47d23110ba46ff58936d4330" },
      { operation: "read" },
      { decision_type: "deny" },
      { active: "false" },
    ]) {
      expect({ fields, ids: RULE_IDS(await run([acl(fields)])) }).toEqual({ fields, ids: [] });
    }
  });

  it("ignores a script on an ACL that is not advanced, as the platform does", async () => {
    expect(RULE_IDS(await run([acl({ script: "answer = false;" })]))).toEqual(["SN-SEC-006"]);
  });

  it("blocks deactivating, allowing, or deleting with Now.del a deny ACL", async () => {
    const deny = acl({ decision_type: "deny", operation: "read" });
    const cases: [BuiltUnit, string][] = [
      [acl({ decision_type: "deny", operation: "read", active: "false" }), "deactivates"],
      [acl({ operation: "read" }), "turns"],
      [deletion, "deletes"],
    ];
    for (const [now, verb] of cases) {
      const result = await run([now, role("r".repeat(32))], [deny, role("r".repeat(32))]);
      expect(result.passed).toBe(false);
      expect(result.findings).toEqual([
        expect.objectContaining({
          ruleId: "SN-SEC-007",
          message: expect.stringContaining(`the change ${verb} the deny read ACL incident`),
        }),
      ]);
    }
  });

  it("does not report deleting a deny ACL that was already inactive", async () => {
    const result = await run(
      [deletion],
      [acl({ decision_type: "deny", operation: "read", active: "false" })],
    );
    expect(result.findings).toEqual([]);
  });

  it("warns when admin overrides are turned off", async () => {
    const result = await run(
      [acl({ admin_overrides: "false" }), role("r".repeat(32))],
      [acl({}), role("r".repeat(32))],
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-SEC-008", severity: "warn", field: "admin_overrides" }),
    ]);
  });

  it("leaves units of other classes alone", async () => {
    expect((await run([unitOf("sys_script_include", { description: "d" })])).findings).toEqual([]);
  });
});
