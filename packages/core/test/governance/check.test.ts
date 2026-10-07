import { describe, expect, it } from "bun:test";
import { type ChangedRecords, checkFiles, type ScriptChecker } from "@snagentic/core";

const records: ChangedRecords = {
  resolve: async () => "c0ffee",
  changedSince: async () => [],
  current: async (base) => ({
    className: "sys_script_include",
    scope: "global",
    fields: { description: "d", script: base.includes("bad") ? "eval(x);" : "ok();" },
    files: { script: `${base}.script.js` },
  }),
  at: async () => ({
    className: "sys_script_include",
    scope: "global",
    fields: { description: "d", script: "ok();" },
    files: {},
  }),
};
const checker: ScriptChecker = {
  check: (source) => ({
    parsed: true,
    hits: source.includes("eval(") ? [{ ruleId: "SN-SEC-001", line: 1, message: "eval" }] : [],
  }),
};
const deps = { records, checker };
const depsFor = (instance: string) => {
  expect(instance).toBe("pdi");
  return deps;
};
const ROOT = "instances/pdi/metadata";

describe("checkFiles", () => {
  it("reports protected files without validating anything before an edit", async () => {
    const result = await checkFiles(depsFor, {
      paths: [".snagentic/pdi/state.json", `${ROOT}/global/sys_script_include/bad--1.script.js`],
      validate: false,
    });
    expect(result).toMatchObject({
      protected: [{ path: ".snagentic/pdi/state.json" }],
      findings: [],
      passed: false,
    });
  });

  it("validates the edited records after an edit, ignoring files outside the metadata", async () => {
    const result = await checkFiles(depsFor, {
      paths: [`${ROOT}/global/sys_script_include/bad--1.script.js`, "AGENTS.md"],
      validate: true,
    });
    expect(result).toMatchObject({
      protected: [],
      findings: [{ ruleId: "SN-SEC-001" }],
      passed: false,
    });
    const clean = await checkFiles(depsFor, {
      paths: ["AGENTS.md"],
      validate: true,
    });
    expect(clean).toEqual({ protected: [], findings: [], passed: true });
  });

  it("needs no instance to report protected files, in a workspace with several or none", async () => {
    const result = await checkFiles(
      () => {
        throw new Error("no instance to validate");
      },
      { paths: ["snagentic.yaml", "instances/test/instance.yaml", "AGENTS.md"], validate: true },
    );
    expect(result.protected.map((p) => p.path)).toEqual([
      "snagentic.yaml",
      "instances/test/instance.yaml",
    ]);
    expect(result.passed).toBe(false);
  });

  it("validates each edited record against the instance its path names", async () => {
    const seen: string[] = [];
    const result = await checkFiles(
      (instance) => {
        seen.push(instance);
        return deps;
      },
      {
        paths: [
          "instances/dev/metadata/global/sys_script_include/bad--1.script.js",
          "instances/prod/metadata/global/sys_script_include/ok--2.script.js",
        ],
        validate: true,
      },
    );
    expect(seen.sort()).toEqual(["dev", "prod"]);
    expect(result.findings).toMatchObject([{ ruleId: "SN-SEC-001" }]);
  });

  it("validates only the named instance's records when one is named", async () => {
    const result = await checkFiles(depsFor, {
      paths: [
        `${ROOT}/global/sys_script_include/ok--1.script.js`,
        "instances/prod/metadata/global/sys_script_include/bad--2.script.js",
      ],
      validate: true,
      instance: "pdi",
    });
    expect(result).toEqual({ protected: [], findings: [], passed: true });
  });
});
