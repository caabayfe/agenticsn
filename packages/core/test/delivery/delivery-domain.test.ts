import { describe, expect, it } from "bun:test";
import {
  type Artifact,
  changeOf,
  type Finding,
  gateOf,
  globMatches,
  type PlannedWrite,
  planId,
  readWaivers,
  recordHash,
  ScopeName,
  SysId,
  TableName,
} from "@snagentic/core";

const SYS_ID = "0123456789abcdef0123456789abcdef";

function artifact(fields: Record<string, string>, extra: Partial<Artifact> = {}): Artifact {
  return {
    identity: {
      sysId: SysId.parse(SYS_ID),
      className: TableName.parse("sys_script"),
      scope: ScopeName.fromInstance("global"),
      domain: "global",
    },
    meta: {},
    fields,
    redacted: [],
    hash: recordHash("sys_script", fields),
    ...extra,
  };
}
const version = (fields: Record<string, string>, extra: Partial<Artifact> = {}) => ({
  artifact: artifact(fields, extra),
  storedHash: "base-hash",
});
const PATH = "global/sys_script/rule--0123456789abcdef0123456789abcdef.yaml";

describe("changeOf", () => {
  it("writes only the fields that changed, against the hash last pulled", () => {
    const outcome = changeOf(
      PATH,
      version({ name: "Rule", script: "a();", order: "100" }),
      version({ name: "Rule", script: "b();", order: "100" }),
    );
    expect(outcome).toEqual({
      kind: "write",
      write: {
        operation: "update",
        table: "sys_script",
        sysId: SYS_ID,
        scope: "global",
        path: PATH,
        values: { script: "b();" },
        baseHash: "base-hash",
      },
    });
  });

  it("clears a field whose line was removed, and ignores an unchanged record", () => {
    const outcome = changeOf(
      PATH,
      version({ name: "Rule", condition: "x" }),
      version({ name: "Rule" }),
    );
    expect(outcome.kind === "write" && outcome.write.values).toEqual({ condition: "" });
    expect(changeOf(PATH, version({ name: "Rule" }), version({ name: "Rule" }))).toEqual({
      kind: "none",
    });
  });

  it("creates a new record with all its fields and its own sys_id", () => {
    const named = `global/sys_script/new--${SYS_ID}.yaml`;
    const outcome = changeOf(named, null, version({ name: "New", script: "x();" }));
    expect(outcome).toMatchObject({
      kind: "write",
      write: {
        operation: "create",
        sysId: SYS_ID,
        values: { name: "New", script: "x();" },
        baseHash: null,
      },
    });
  });

  it("asks a new record's file to have the name the next pull will give it", () => {
    expect(changeOf(PATH, null, version({ name: "New" }))).toEqual({
      kind: "problem",
      problem: {
        path: PATH,
        reason: `rename it to global/sys_script/new--${SYS_ID}.yaml, the name the next pull gives this record`,
      },
    });
  });

  it("refuses deletes, identity changes, redacted fields and denied classes", () => {
    expect(changeOf(PATH, version({ name: "Rule" }), null)).toMatchObject({
      kind: "problem",
      problem: { reason: expect.stringContaining("set active to false") },
    });
    const other = version(
      { name: "Rule" },
      {
        identity: {
          sysId: SysId.parse("f".repeat(32)),
          className: TableName.parse("sys_script"),
          scope: ScopeName.fromInstance("global"),
          domain: "global",
        },
      },
    );
    expect(changeOf(PATH, version({ name: "Rule" }), other)).toMatchObject({ kind: "problem" });
    expect(
      changeOf(
        PATH,
        version({ name: "P" }, { redacted: ["password"] }),
        version({ name: "P", password: "x" }),
      ),
    ).toMatchObject({ kind: "problem", problem: { reason: expect.stringContaining("password") } });
    const denied = version(
      { name: "C" },
      {
        identity: {
          sysId: SysId.parse(SYS_ID),
          className: TableName.parse("sys_cred"),
          scope: ScopeName.fromInstance("global"),
          domain: "global",
        },
      },
    );
    expect(changeOf(PATH, null, denied)).toMatchObject({ kind: "problem" });
    expect(changeOf(PATH, null, null)).toEqual({ kind: "none" });
  });
});

describe("waivers", () => {
  const today = new Date("2026-10-06T12:00:00Z");
  const valid = {
    rule: "SN-SEC-001",
    path: "instances/dev/metadata/**",
    reason: "r",
    approver: "a",
    expires: "2027-01-01",
  };

  it("keeps waivers in force and reports expired, too-long and malformed ones", () => {
    const { waivers, problems } = readWaivers(
      {
        waivers: [
          valid,
          { ...valid, expires: "2026-10-01" },
          { ...valid, expires: "2028-01-01" },
          { ...valid, approver: "" },
          { ...valid, expires: "soon" },
          "x",
        ],
      },
      today,
    );
    expect(waivers).toEqual([valid]);
    expect(problems.map((p) => [p.index, p.reason])).toEqual([
      [1, "expired on 2026-10-01"],
      [2, "expires more than 366 days ahead"],
      [3, "missing approver"],
      [4, "expires must be a date (YYYY-MM-DD)"],
      [5, "not a mapping"],
    ]);
    expect(readWaivers(null, today)).toEqual({ waivers: [], problems: [] });
  });

  it("matches paths by glob: * and ? within a folder, ** across folders", () => {
    expect(globMatches("a/*/c.js", "a/b/c.js")).toBe(true);
    expect(globMatches("a/*/c.js", "a/b/x/c.js")).toBe(false);
    expect(globMatches("a/**/c.js", "a/b/x/c.js")).toBe(true);
    expect(globMatches("a/?.js", "a/b.js")).toBe(true);
    expect(globMatches("a/b.js", "a/bxjs")).toBe(false);
  });
});

describe("the gate and the plan id", () => {
  const finding = (ruleId: string, severity: "block" | "warn"): Finding => ({
    ruleId,
    severity,
    title: "",
    path: "global/sys_script/rule--x.script.js",
    field: "script",
    line: 3,
    message: "m",
    evidence: "",
    why: "",
    remediation: "",
  });
  const waiver = {
    rule: "SN-SEC-001",
    path: "instances/dev/metadata/global/**",
    reason: "approved",
    approver: "lead",
    expires: "2027-01-01",
  };

  it("passes only without unwaived block findings", () => {
    const findings = [finding("SN-SEC-001", "block"), finding("SN-MNT-001", "warn")];
    expect(gateOf(findings, [], [], "instances/dev/metadata")).toMatchObject({
      passed: false,
      warnings: 1,
    });
    const waived = gateOf(findings, [waiver], [], "instances/dev/metadata");
    expect(waived).toMatchObject({
      passed: true,
      blocking: [],
      waived: [{ ruleId: "SN-SEC-001", approver: "lead" }],
    });
  });

  it("changes the plan id with any value, base or gate difference", () => {
    const write: PlannedWrite = {
      operation: "update",
      table: "t",
      sysId: SYS_ID,
      scope: "global",
      path: PATH,
      values: { a: "1" },
      baseHash: "h",
    };
    const gate = gateOf([], [], [], "p");
    const id = planId("c1", [write], gate);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(planId("c1", [write], gate)).toBe(id);
    expect(planId("c2", [write], gate)).not.toBe(id);
    expect(planId("c1", [{ ...write, values: { a: "2" } }], gate)).not.toBe(id);
    expect(planId("c1", [write], gateOf([finding("SN-SEC-001", "block")], [], [], "p"))).not.toBe(
      id,
    );
  });
});
