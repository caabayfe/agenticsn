import { describe, expect, it } from "bun:test";
import { type ChangedRecords, type RecordVersion, validate } from "@snagentic/core";

const BASE = "global/sys_security_acl/incident--a1c";
const RULE_IDS = (result: Awaited<ReturnType<typeof validate>>) =>
  result.findings.map((finding) => finding.ruleId);

const acl = (fields: Record<string, string>): RecordVersion => ({
  className: "sys_security_acl",
  scope: "global",
  fields: {
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
  files: {},
});

// The ACL now and at the base, and the role records pointing at it in each.
function records(options: {
  now: RecordVersion | null;
  before?: RecordVersion;
  roles?: { now: number; before: number };
  lookups?: string[];
}): ChangedRecords {
  return {
    resolve: async () => "c0ffee",
    changedSince: async () => [BASE],
    current: async () => options.now,
    at: async () => options.before ?? null,
    mirrorMerge: async () => null,
    countReferences: async (className, field, sysId, commit) => {
      options.lookups?.push(`${className}.${field}=${sysId} at ${commit ?? "workspace"}`);
      return commit === null ? (options.roles?.now ?? 0) : (options.roles?.before ?? 0);
    },
  };
}

const checker = { check: () => ({ parsed: true as const, hits: [] }) };
const run = (deps: ChangedRecords) => validate({ records: deps, checker }, { base: "HEAD" });

describe("validate: ACL records (ADR-0024)", () => {
  it("blocks a new write ACL that no role, condition or script restricts", async () => {
    const lookups: string[] = [];
    const result = await run(records({ now: acl({}), lookups }));
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-SEC-006",
        severity: "block",
        path: `${BASE}.yaml`,
        message: "the write ACL incident has no role, condition or script, so it restricts nothing",
      }),
    ]);
    expect(lookups).toEqual(["sys_security_acl_role.sys_security_acl=a1c at workspace"]);
  });

  it("passes it once a role record points at it", async () => {
    const result = await run(records({ now: acl({}), roles: { now: 1, before: 0 } }));
    expect(result.findings).toEqual([]);
  });

  it("blocks removing the last role of a write ACL", async () => {
    const result = await run(
      records({ now: acl({}), before: acl({}), roles: { now: 0, before: 1 } }),
    );
    expect(RULE_IDS(result)).toEqual(["SN-SEC-006"]);
  });

  it("does not report an unrestricted ACL the change did not open", async () => {
    const result = await run(records({ now: acl({ description: "d" }), before: acl({}) }));
    expect(result.findings).toEqual([]);
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
      const lookups: string[] = [];
      const result = await run(records({ now: acl(fields), lookups }));
      expect({ fields, ids: RULE_IDS(result), lookups }).toEqual({ fields, ids: [], lookups: [] });
    }
  });

  it("ignores a script on an ACL that is not advanced, as the platform does", async () => {
    const result = await run(records({ now: acl({ script: "answer = false;" }) }));
    expect(RULE_IDS(result)).toEqual(["SN-SEC-006"]);
  });

  it("blocks deactivating, deleting or allowing a deny ACL", async () => {
    const deny = acl({ decision_type: "deny", operation: "read" });
    const cases: [RecordVersion | null, string][] = [
      [acl({ decision_type: "deny", operation: "read", active: "false" }), "deactivates"],
      [null, "deletes"],
      [acl({ operation: "read" }), "turns"],
    ];
    for (const [now, verb] of cases) {
      const result = await run(records({ now, before: deny, roles: { now: 1, before: 1 } }));
      expect(result.passed).toBe(false);
      expect(result.findings).toEqual([
        expect.objectContaining({
          ruleId: "SN-SEC-007",
          message: expect.stringContaining(`the change ${verb} the deny read ACL incident`),
        }),
      ]);
    }
  });

  it("does not report a deny ACL that was already inactive", async () => {
    const before = acl({ decision_type: "deny", active: "false" });
    const result = await run(records({ now: null, before }));
    expect(result).toMatchObject({ records: 0, findings: [] });
  });

  it("warns when admin overrides are turned off", async () => {
    const result = await run(
      records({
        now: acl({ admin_overrides: "false" }),
        before: acl({}),
        roles: { now: 1, before: 1 },
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-SEC-008", severity: "warn", field: "admin_overrides" }),
    ]);
  });

  it("leaves records of other classes alone", async () => {
    const result = await run(
      records({
        now: { ...acl({}), className: "sys_script_include", fields: { description: "d" } },
      }),
    );
    expect(result.findings).toEqual([]);
  });
});
