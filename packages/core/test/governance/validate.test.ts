import { describe, expect, it } from "bun:test";
import {
  type ChangedRecords,
  MAX_SCRIPT_BYTES,
  type RecordVersion,
  type ScriptChecker,
  type ScriptContext,
  validate,
} from "@snagentic/core";

// Reports each /*RULE-ID*/ marker as a hit on its line; "SYNTAX ERROR" does not parse.
function fakeChecker(seen: { ruleIds: readonly string[]; context: ScriptContext }[] = []) {
  const checker: ScriptChecker = {
    check(source, ruleIds, context) {
      seen.push({ ruleIds, context });
      const lines = source.split("\n");
      const broken = lines.findIndex((line) => line.includes("SYNTAX ERROR"));
      if (broken >= 0) {
        return { parsed: false, line: broken + 1, message: "Unexpected token ERROR" };
      }
      const hits = lines.flatMap((line, index) =>
        [...line.matchAll(/\/\*(SN-[A-Z]+-\d+)\*\//g)].flatMap(([, ruleId = ""]) =>
          ruleIds.includes(ruleId) ? [{ ruleId, line: index + 1, message: `hit ${ruleId}` }] : [],
        ),
      );
      return { parsed: true, hits };
    },
  };
  return checker;
}

const version = (
  className: string,
  fields: Record<string, string>,
  scope = "global",
): RecordVersion => ({
  className,
  scope,
  fields,
  files: Object.fromEntries(Object.keys(fields).map((field) => [field, `x.${field}.js`])),
});

function fakeRecords(
  now: Record<string, RecordVersion | null>,
  before: Record<string, RecordVersion> = {},
): ChangedRecords {
  return {
    resolve: async (ref) => (ref === "nope" ? null : "c0ffee"),
    changedSince: async () => Object.keys(now).sort(),
    current: async (base) => now[base] ?? null,
    at: async (_commit, base) => before[base] ?? null,
  };
}

const DESCRIBED = { description: "Sets priority from impact" };

describe("validate", () => {
  it("reports findings in a new record's scripts, with rule, path, line and remediation", async () => {
    const records = fakeRecords({
      "global/sys_script/br--b1": version("sys_script", {
        ...DESCRIBED,
        when: "before",
        script: "var a = 1;\ngr.setWorkflow(false); /*SN-MNT-004*/",
      }),
    });
    const result = await validate({ records, checker: fakeChecker() }, { base: "HEAD" });
    expect(result).toMatchObject({ base: "HEAD", records: 1, passed: true });
    expect(result.findings).toEqual([
      {
        ruleId: "SN-MNT-004",
        severity: "warn",
        title: "Avoid setWorkflow(false)",
        path: "x.script.js",
        field: "script",
        line: 2,
        message: "hit SN-MNT-004",
        evidence: "gr.setWorkflow(false); /*SN-MNT-004*/",
        why: expect.any(String),
        remediation: expect.any(String),
      },
    ]);
  });

  it("reports only what the change introduced, matching unchanged lines that moved", async () => {
    const old = "eval(a); /*SN-SEC-001*/";
    const records = fakeRecords(
      { b: version("sys_script_include", { ...DESCRIBED, script: `// new line\n${old}\n${old}` }) },
      { b: version("sys_script_include", { ...DESCRIBED, script: old }) },
    );
    const result = await validate({ records, checker: fakeChecker() }, { base: "HEAD" });
    expect(result.findings.map((f) => [f.ruleId, f.line])).toEqual([["SN-SEC-001", 3]]);
    expect(result).toMatchObject({ passed: false, counts: { block: 1, warn: 0, info: 0 } });
  });

  it("runs only the rules for the script's kind and class, with the record's context", async () => {
    const seen: { ruleIds: readonly string[]; context: ScriptContext }[] = [];
    const records = fakeRecords({
      c: version(
        "sys_script_client",
        { ...DESCRIBED, type: "onChange", name: "Hide", script: "x" },
        "x_acme_app",
      ),
    });
    await validate({ records, checker: fakeChecker(seen) }, { base: "HEAD" });
    expect(seen[0]?.context).toEqual({
      className: "sys_script_client",
      kind: "client",
      scoped: true,
      when: "",
      type: "onChange",
      name: "Hide",
    });
    expect(seen[0]?.ruleIds).toContain("SN-UX-001");
    expect(seen[0]?.ruleIds).not.toContain("SN-PERF-001");
  });

  it("passes business-rule timing as the platform runs it", async () => {
    const seen: { ruleIds: readonly string[]; context: ScriptContext }[] = [];
    const records = fakeRecords({
      b: version("sys_script", { ...DESCRIBED, when: "before_display", script: "x" }),
    });
    await validate({ records, checker: fakeChecker(seen) }, { base: "HEAD" });
    expect(seen[0]?.context.when).toBe("display");
  });

  it("reports a script that does not parse as a blocking finding", async () => {
    const records = fakeRecords({
      b: version("sys_script_include", { ...DESCRIBED, script: "var a = 1;\nSYNTAX ERROR" }),
    });
    const result = await validate({ records, checker: fakeChecker() }, { base: "HEAD" });
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-MNT-007", line: 2, severity: "block" }),
    ]);
  });

  it("never echoes a credential: lines the credential rule flags are masked for every rule", async () => {
    const records = fakeRecords({
      b: version("sys_script_include", {
        ...DESCRIBED,
        script: "var password = 'S3cr3t!x'; /*SN-SEC-002*/ /*SN-MNT-001*/",
      }),
    });
    const result = await validate({ records, checker: fakeChecker() }, { base: "HEAD" });
    expect(result.findings).toHaveLength(2);
    for (const item of result.findings) {
      expect(item.evidence).not.toContain("S3cr3t");
    }
  });

  it("asks new script records for a description, and only new ones", async () => {
    const script = { script: "var a = 1;" };
    const fresh = await validate(
      {
        records: fakeRecords({ b: version("sys_script_include", script) }),
        checker: fakeChecker(),
      },
      { base: "HEAD" },
    );
    expect(fresh.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-MNT-006", path: "b.yaml", field: "description" }),
    ]);
    const edited = await validate(
      {
        records: fakeRecords(
          { b: version("sys_script_include", script) },
          { b: version("sys_script_include", script) },
        ),
        checker: fakeChecker(),
      },
      { base: "HEAD" },
    );
    expect(edited.findings).toEqual([]);
  });

  it("checks only the given paths, and skips deleted records", async () => {
    const records = fakeRecords({
      "global/sys_script_include/a--1": version("sys_script_include", DESCRIBED),
      "global/sys_script_include/b--2": null,
    });
    const result = await validate(
      { records, checker: fakeChecker() },
      { base: "HEAD", paths: ["global/sys_script_include/a--1.script.js"] },
    );
    expect(result.records).toBe(1);
  });

  it("says what it did not check rather than passing it silently", async () => {
    const records = fakeRecords({
      b: version("sys_script_include", { ...DESCRIBED, script: "x".repeat(MAX_SCRIPT_BYTES + 1) }),
    });
    const result = await validate({ records, checker: fakeChecker() }, { base: "HEAD" });
    expect(result.notChecked).toEqual([
      { path: "x.script.js", reason: expect.stringContaining("bytes") },
    ]);
    expect(result.rulesNotChecked.map((rule) => rule.ruleId)).toEqual(["SN-UPG-002"]);
  });

  it("ignores the script of a business rule that is not advanced", async () => {
    const records = fakeRecords({
      b: version("sys_script", {
        ...DESCRIBED,
        advanced: "false",
        script: "eval(a); /*SN-SEC-001*/",
      }),
    });
    expect(
      (await validate({ records, checker: fakeChecker() }, { base: "HEAD" })).findings,
    ).toEqual([]);
  });

  it("explains a base that names no commit", async () => {
    await expect(
      validate({ records: fakeRecords({}), checker: fakeChecker() }, { base: "nope" }),
    ).rejects.toMatchObject({ code: "unknown-base" });
  });
});
