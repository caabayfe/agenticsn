import { describe, expect, it } from "bun:test";
import { gateOf, validate } from "@snagentic/core";
import { governanceOf } from "../support/fake-governance";

// What validate says about a Fluent project's build itself (ADR-0031): it must build, its keys
// must be committed, and it should build with the SDK snagentic embeds.

const APP = "source/x_app";
const run = (projects: Parameters<typeof governanceOf>[0]) =>
  validate(governanceOf(projects), { base: "HEAD" });

describe("validate, Fluent projects", () => {
  it("passes a changed project that builds and keeps its keys", async () => {
    expect(await run({ [APP]: { now: [], base: [] } })).toMatchObject({
      fluentProjects: 1,
      passed: true,
      findings: [],
    });
  });

  it("blocks on each build error, at its file and line in the workspace", async () => {
    const error = {
      file: "src/fluent/a.now.ts",
      line: 9,
      column: 25,
      code: "ts2551",
      message: "no updateRecordz",
    };
    const result = await run({ [APP]: { now: { errors: [error] } } });
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-009",
        severity: "block",
        path: "source/x_app/src/fluent/a.now.ts",
        root: "workspace",
        line: 9,
        message: "ts2551: no updateRecordz",
        evidence: "column 25",
      }),
    ]);
  });

  it("blocks a build that failed without naming an error, rather than reporting nothing", async () => {
    const result = await run({ [APP]: { now: { errors: [] } } });
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-MNT-009", severity: "block", path: APP }),
    ]);
  });

  it("names the place of a build error, but not an empty one", async () => {
    const error = { file: "", line: 0, column: 0, code: "fluent-build", message: "stopped" };
    const result = await run({ [APP]: { now: { errors: [error] } } });
    expect(result.findings).toEqual([
      expect.objectContaining({ ruleId: "SN-MNT-009", path: APP, line: null }),
    ]);
  });

  it("blocks until the generated keys are committed", async () => {
    const result = await run({
      [APP]: { now: [], base: [], keys: { committed: null, built: "k" } },
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-010",
        path: "source/x_app/src/fluent/generated/keys.ts",
      }),
    ]);
  });

  it("warns when the project names another SDK version, and not when it names none", async () => {
    const result = await run({
      "source/x_a": { now: [], base: [], declaredSdk: "^4.12.0" },
      "source/x_b": { now: [], base: [], declaredSdk: null },
    });
    expect(result.passed).toBe(true);
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-UPG-003",
        severity: "warn",
        path: "source/x_a/package.json",
        message: "the project names @servicenow/sdk ^4.12.0; snagentic builds with 4.13.6",
      }),
    ]);
  });

  it("is waived only by a waiver naming the project's source", async () => {
    const error = { file: "src/fluent/a.now.ts", line: 1, column: 1, code: "ts1", message: "x" };
    const { findings } = await run({ [APP]: { now: { errors: [error] } } });
    const waiver = (path: string) => ({
      rule: "SN-MNT-009",
      path,
      reason: "accepted",
      approver: "owner",
      expires: "2999-01-01",
    });
    expect(
      gateOf(
        findings,
        [waiver("instances/pdi/metadata/source/x_app/**")],
        [],
        "instances/pdi/metadata",
      ).passed,
    ).toBe(false);
    expect(
      gateOf(findings, [waiver("source/x_app/**")], [], "instances/pdi/metadata"),
    ).toMatchObject({
      passed: true,
      waived: [
        expect.objectContaining({ ruleId: "SN-MNT-009", path: "source/x_app/src/fluent/a.now.ts" }),
      ],
    });
  });
});
