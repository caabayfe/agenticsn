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
const ROOT = "instances/pdi/metadata";

describe("checkFiles", () => {
  it("reports protected files without validating anything before an edit", async () => {
    const result = await checkFiles(deps, {
      paths: [".snagentic/pdi/state.json", `${ROOT}/global/sys_script_include/bad--1.script.js`],
      metadataRoot: ROOT,
      validate: false,
    });
    expect(result).toMatchObject({
      protected: [{ path: ".snagentic/pdi/state.json" }],
      findings: [],
      passed: false,
    });
  });

  it("validates the edited records after an edit, ignoring files outside the metadata", async () => {
    const result = await checkFiles(deps, {
      paths: [`${ROOT}/global/sys_script_include/bad--1.script.js`, "AGENTS.md"],
      metadataRoot: ROOT,
      validate: true,
    });
    expect(result).toMatchObject({
      protected: [],
      findings: [{ ruleId: "SN-SEC-001" }],
      passed: false,
    });
    const clean = await checkFiles(deps, {
      paths: ["AGENTS.md"],
      metadataRoot: ROOT,
      validate: true,
    });
    expect(clean).toEqual({ protected: [], findings: [], passed: true });
  });
});
