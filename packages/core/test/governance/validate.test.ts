import { describe, expect, it } from "bun:test";
import { MAX_SCRIPT_BYTES, type ScriptContext, validate } from "@snagentic/core";
import { fakeChecker, governanceOf, unitOf } from "../support/fake-governance";

// validate on built units (ADR-0031 item 6): what the change added or edited in a project's
// build, checked with the record rules and the script rules, reported at the source file.

const APP = "source/x_acme_app";
const GLOBAL = "source/global";
const DESCRIBED = { description: "Sets priority from impact" };
const SCRIPT_FILE = "src/fluent/rule.server.js";

describe("validate", () => {
  it("reports findings in a new unit's script, at the include file that holds it", async () => {
    const script = "var a = 1;\ngr.setWorkflow(false); /*SN-MNT-004*/";
    const deps = governanceOf({
      [GLOBAL]: {
        now: [unitOf("sys_script", { ...DESCRIBED, when: "before", script })],
        base: [],
        scripts: new Map([[SCRIPT_FILE, `${script}\n`]]),
      },
    });
    const result = await validate(deps, { base: "HEAD" });
    expect(result).toMatchObject({ base: "HEAD", units: 1, fluentProjects: 1, passed: true });
    expect(result.findings).toEqual([
      {
        ruleId: "SN-MNT-004",
        severity: "warn",
        title: "Avoid setWorkflow(false)",
        path: `${GLOBAL}/${SCRIPT_FILE}`,
        root: "workspace",
        field: "script",
        line: 2,
        message: "hit SN-MNT-004",
        evidence: "gr.setWorkflow(false); /*SN-MNT-004*/",
        why: expect.any(String),
        remediation: expect.any(String),
      },
    ]);
  });

  it("points an inline script's findings to its unit", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "eval(a); /*SN-SEC-001*/" });
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.findings.map((f) => f.path)).toEqual([`${GLOBAL}/${unit.updateName}`]);
  });

  it("reports only what the change introduced, matching unchanged lines that moved", async () => {
    const old = "eval(a); /*SN-SEC-001*/";
    const id = "a".repeat(32);
    const deps = governanceOf({
      [GLOBAL]: {
        now: [
          unitOf("sys_script_include", { ...DESCRIBED, script: `// new line\n${old}\n${old}` }, id),
        ],
        base: [unitOf("sys_script_include", { ...DESCRIBED, script: old }, id)],
      },
    });
    const result = await validate(deps, { base: "HEAD" });
    expect(result.findings.map((f) => [f.ruleId, f.line])).toEqual([["SN-SEC-001", 3]]);
    expect(result).toMatchObject({ passed: false, counts: { block: 1, warn: 0, info: 0 } });
  });

  it("names what an edited unit already held as inherited, not as introduced (decision D)", async () => {
    const old = "eval(a); /*SN-SEC-001*/";
    const id = "b".repeat(32);
    const deps = governanceOf({
      [GLOBAL]: {
        now: [
          unitOf(
            "sys_script_include",
            { ...DESCRIBED, script: `${old}\nnew(); /*SN-SEC-001*/` },
            id,
          ),
        ],
        base: [unitOf("sys_script_include", { ...DESCRIBED, script: old }, id)],
      },
    });
    const result = await validate(deps, { base: "HEAD" });
    expect(result.findings.map((f) => f.line)).toEqual([2]);
    expect(result.inherited.map((f) => [f.ruleId, f.line])).toEqual([["SN-SEC-001", 1]]);
  });

  it("compares a project with its own base when given one, such as its adoption", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "eval(a); /*SN-SEC-001*/" });
    const deps = governanceOf({ [GLOBAL]: { now: [unit], base: null, at: { adopted: [unit] } } });
    const result = await validate(deps, { base: "HEAD", bases: { [GLOBAL]: "adopted" } });
    expect(result).toMatchObject({ units: 0, findings: [], passed: true });
    const fromPull = await validate(deps, { base: "HEAD" });
    expect(fromPull.passed).toBe(false);
  });

  it("checks a project it is told to include even when the change since the base left it", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "eval(a); /*SN-SEC-001*/" });
    const deps = governanceOf({
      [GLOBAL]: { now: [unit], base: [unit], unchanged: true, at: { pushed: [] } },
    });
    expect(await validate(deps, { base: "HEAD" })).toMatchObject({ fluentProjects: 0 });
    const result = await validate(deps, {
      base: "HEAD",
      include: [GLOBAL],
      bases: { [GLOBAL]: "pushed" },
    });
    expect(result).toMatchObject({ fluentProjects: 1, units: 1, passed: false });
  });

  it("judges a project with no base as new in full: it never agreed with the instance", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "eval(a); /*SN-SEC-001*/" });
    const deps = governanceOf({ [GLOBAL]: { now: [unit], base: [unit], unchanged: true } });
    const result = await validate(deps, {
      base: "HEAD",
      include: [GLOBAL],
      bases: { [GLOBAL]: null },
    });
    expect(result.findings.map((f) => f.ruleId)).toEqual(["SN-SEC-001"]);
    expect(result.passed).toBe(false);
  });

  it("checks nothing in units the change left as they were", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "eval(a); /*SN-SEC-001*/" });
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [unit] } }), {
      base: "HEAD",
    });
    expect(result).toMatchObject({ units: 0, findings: [], passed: true });
  });

  it("runs only the rules for the script's kind and class, with the record's context", async () => {
    const seen: { ruleIds: readonly string[]; context: ScriptContext }[] = [];
    const client = unitOf("sys_script_client", {
      ...DESCRIBED,
      type: "onChange",
      name: "Hide",
      script: "x",
    });
    await validate(
      governanceOf({ [APP]: { now: [client], base: [] } }, { checker: fakeChecker(seen) }),
      {
        base: "HEAD",
      },
    );
    expect(seen[0]?.context).toEqual({
      className: "sys_script_client",
      kind: "client",
      scoped: true,
      when: "",
      type: "onChange",
      name: "Hide",
      scope: "x_acme_app",
      privileges: [],
    });
    expect(seen[0]?.ruleIds).toContain("SN-UX-001");
    expect(seen[0]?.ruleIds).not.toContain("SN-PERF-001");
  });

  it("passes a scoped script the cross-scope privileges its application declares, read once", async () => {
    const seen: { ruleIds: readonly string[]; context: ScriptContext }[] = [];
    const include = (name: string) =>
      unitOf("sys_script_include", { ...DESCRIBED, name, script: "x" });
    const deps = governanceOf(
      { [APP]: { now: [include("A"), include("B")], base: [] } },
      { checker: fakeChecker(seen), privileges: { x_acme_app: ["sys_db_object:sys_user"] } },
    );
    await validate(deps, { base: "HEAD" });
    expect(seen.map((s) => s.context.privileges)).toEqual([
      ["sys_db_object:sys_user"],
      ["sys_db_object:sys_user"],
    ]);
    expect(seen[0]?.ruleIds).toContain("SN-MNT-008");
    expect(deps.asked()).toBe(1);
  });

  it("passes business-rule timing as the platform runs it", async () => {
    const seen: { ruleIds: readonly string[]; context: ScriptContext }[] = [];
    const rule = unitOf("sys_script", { ...DESCRIBED, when: "before_display", script: "x" });
    await validate(
      governanceOf({ [GLOBAL]: { now: [rule], base: [] } }, { checker: fakeChecker(seen) }),
      {
        base: "HEAD",
      },
    );
    expect(seen[0]?.context.when).toBe("display");
  });

  it("reports a script that does not parse as a blocking finding", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "var a = 1;\nSYNTAX ERROR" });
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-MNT-007", line: 2, severity: "block" }),
    ]);
  });

  it("never echoes a credential: lines the credential rule flags are masked for every rule", async () => {
    const unit = unitOf("sys_script_include", {
      ...DESCRIBED,
      script: "var password = 'S3cr3t!x'; /*SN-SEC-002*/ /*SN-MNT-001*/",
    });
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.findings).toHaveLength(2);
    for (const item of result.findings) expect(item.evidence).not.toContain("S3cr3t");
  });

  it("asks new script records for a description, and only new ones", async () => {
    const id = "b".repeat(32);
    const unit = unitOf("sys_script_include", { script: "var a = 1;" }, id);
    const fresh = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(fresh.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-006",
        path: `${GLOBAL}/${unit.updateName}`,
        field: "description",
      }),
    ]);
    const edited = unitOf("sys_script_include", { script: "var a = 2;" }, id);
    const later = await validate(governanceOf({ [GLOBAL]: { now: [edited], base: [unit] } }), {
      base: "HEAD",
    });
    expect(later.findings).toEqual([]);
  });

  it("checks every unit of a project new since the base", async () => {
    const unit = unitOf("sys_script_include", { ...DESCRIBED, script: "x" });
    const result = await validate(governanceOf({ [APP]: { now: [unit], base: null } }), {
      base: "HEAD",
    });
    expect(result.units).toBe(1);
  });

  it("builds only the projects holding the paths it is given", async () => {
    const deps = governanceOf({
      [APP]: { now: [unitOf("sys_script_include", { ...DESCRIBED, script: "x" })], base: [] },
      [GLOBAL]: { now: [], base: [] },
    });
    const result = await validate(deps, { base: "HEAD", paths: [`${APP}/src/fluent/a.now.ts`] });
    expect(deps.built).toEqual([APP]);
    expect(result.units).toBe(1);
  });

  it("says what it did not check rather than passing it silently", async () => {
    const unit = unitOf("sys_script_include", {
      ...DESCRIBED,
      script: "x".repeat(MAX_SCRIPT_BYTES + 1),
    });
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.notChecked).toEqual([
      { path: `${GLOBAL}/${unit.updateName}`, reason: expect.stringContaining("bytes") },
    ]);
    expect(result.rulesNotChecked.map((rule) => rule.ruleId)).toEqual(["SN-UPG-002"]);
  });

  it("ignores the script of a business rule that is not advanced", async () => {
    const unit = unitOf("sys_script", {
      ...DESCRIBED,
      advanced: "false",
      script: "eval(a); /*SN-SEC-001*/",
    });
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    expect(result.findings).toEqual([]);
  });

  it("refuses edits to the mirror: it is the instance as last pulled (ADR-0031 item 2)", async () => {
    const deps = governanceOf(
      {},
      { edited: ["instances/dev/metadata/global/sys_script/rule--x.yaml"] },
    );
    const result = await validate(deps, { base: "HEAD" });
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-013",
        severity: "block",
        path: "instances/dev/metadata/global/sys_script/rule--x.yaml",
        root: "workspace",
      }),
    ]);
    expect(result.passed).toBe(false);
    expect((await validate(deps, { base: "HEAD", paths: ["source/x/a.ts"] })).findings).toEqual([]);
  });

  it("explains a base that names no commit", async () => {
    await expect(validate(governanceOf({}), { base: "nope" })).rejects.toMatchObject({
      code: "unknown-base",
    });
  });
});
