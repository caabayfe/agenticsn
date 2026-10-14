import { describe, expect, it } from "bun:test";
import {
  type ChangedRecords,
  type FluentBuild,
  type FluentProject,
  type FluentProjects,
  gateOf,
  validate,
} from "@snagentic/core";

const noRecords: ChangedRecords = {
  resolve: async () => "c0ffee",
  changedSince: async () => [],
  current: async () => null,
  at: async () => null,
  countReferences: async () => 0,
  mirrorMerge: async () => null,
};
const checker = { check: () => ({ parsed: true as const, hits: [] }) };

const project = (path: string, declaredSdk: string | null = "4.13.6"): FluentProject => ({
  path,
  declaredSdk,
});
const clean: FluentBuild = { built: true, keysChanged: false, deletes: [] };

function fakeFluent(
  changed: readonly FluentProject[],
  builds: Record<string, FluentBuild>,
  seen: string[] = [],
): FluentProjects {
  return {
    changedSince: async () => changed,
    holding: async (paths) => changed.filter((p) => paths.some((x) => x.startsWith(`${p.path}/`))),
    build: async (p) => {
      seen.push(p.path);
      return builds[p.path] ?? clean;
    },
    sdkVersion: async () => "4.13.6",
  };
}

const run = (fluent: FluentProjects, paths?: { paths: string[]; fluentPaths: string[] }) =>
  validate({ records: noRecords, checker, fluent }, { base: "HEAD", ...paths });

describe("validate, Fluent projects (ADR-0028)", () => {
  it("passes a changed project that builds, keeps its keys and deletes nothing", async () => {
    const result = await run(fakeFluent([project("source/x_app")], {}));
    expect(result).toMatchObject({ fluentProjects: 1, passed: true, findings: [] });
  });

  it("blocks on each build error, at its file and line in the workspace", async () => {
    const error = { file: "src/fluent/a.now.ts", line: 9, column: 25, code: "ts2551" };
    const result = await run(
      fakeFluent([project("source/x_app")], {
        "source/x_app": { built: false, errors: [{ ...error, message: "no updateRecordz" }] },
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-008",
        severity: "block",
        path: "source/x_app/src/fluent/a.now.ts",
        root: "workspace",
        line: 9,
        message: "ts2551: no updateRecordz",
        evidence: "column 25",
      }),
    ]);
  });

  it("blocks until the generated keys are committed", async () => {
    const result = await run(
      fakeFluent([project("source/x_app")], {
        "source/x_app": { built: true, keysChanged: true, deletes: [] },
      }),
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-009",
        path: "source/x_app/src/fluent/generated/keys.ts",
      }),
    ]);
  });

  it("blocks a build that would delete records", async () => {
    const result = await run(
      fakeFluent([project("source/x_app")], {
        "source/x_app": {
          built: true,
          keysChanged: false,
          deletes: ["sys_choice_var__m_sys_hub_action_input_43400a15_sort_type"],
        },
      }),
    );
    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-010",
        message: "the build deletes sys_choice_var__m_sys_hub_action_input_43400a15_sort_type",
      }),
    ]);
  });

  it("warns when the project names another SDK version, and not when it names none", async () => {
    const result = await run(
      fakeFluent([project("source/x_a", "^4.12.0"), project("source/x_b", null)], {}),
    );
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

  it("builds only the projects holding the paths it is given", async () => {
    const seen: string[] = [];
    const fluent = fakeFluent([project("source/x_a"), project("source/x_b")], {}, seen);
    const result = await run(fluent, {
      paths: [],
      fluentPaths: ["source/x_b/src/fluent/f.now.ts"],
    });
    expect(seen).toEqual(["source/x_b"]);
    expect(result.fluentProjects).toBe(1);
  });

  it("builds no project when only record paths are given", async () => {
    const seen: string[] = [];
    const result = await run(fakeFluent([project("source/x_a")], {}, seen), {
      paths: ["sys_script/a.yaml"],
      fluentPaths: [],
    });
    expect(seen).toEqual([]);
    expect(result.fluentProjects).toBe(0);
  });

  it("reports nothing about Fluent without the port", async () => {
    const result = await validate({ records: noRecords, checker }, { base: "HEAD" });
    expect(result.fluentProjects).toBe(0);
  });

  it("is not covered by a waiver for the same path under the metadata folder", async () => {
    const error = { file: "src/fluent/a.now.ts", line: 1, column: 1, code: "ts1", message: "x" };
    const { findings } = await run(
      fakeFluent([project("source/x_app")], { "source/x_app": { built: false, errors: [error] } }),
    );
    const waiver = {
      rule: "SN-MNT-008",
      path: "instances/pdi/metadata/source/x_app/**",
      reason: "accepted",
      approver: "owner",
      expires: "2999-01-01",
    };
    const gate = gateOf(findings, [waiver], [], "instances/pdi/metadata");
    expect(gate.passed).toBe(false);
    expect(gate.blocking).toEqual([
      expect.objectContaining({ ruleId: "SN-MNT-008", path: "source/x_app/src/fluent/a.now.ts" }),
    ]);
  });
});
