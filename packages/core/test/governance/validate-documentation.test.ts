import { describe, expect, it } from "bun:test";
import { type DocumentedRecords, validate } from "@snagentic/core";
import { governanceOf, unitOf } from "../support/fake-governance";

// validate names the documentation a change may make wrong (ADR-0035, spec 010 P4).

const GLOBAL = "source/global";
const RULE_ID = "0c1345dd0783f01028ef0a701ad300fa";
const DESCRIBED = { description: "Sets the group", when: "before", script: "var a = 1;" };

function documentation(stale = false): DocumentedRecords & { asked: unknown[][] } {
  const asked: unknown[][] = [];
  return {
    asked,
    citing: async (records) => {
      asked.push([...records]);
      return records
        .filter((record) => record.sysId === RULE_ID)
        .map((record) => ({
          ...record,
          page: "documentation/processes/incident/configure/assign.md",
          evidence: ["E01", "E04"],
        }));
    },
    stale: async () =>
      stale
        ? [
            {
              page: "documentation/processes/incident/use/report.md",
              evidence: "E02",
              anchor: "sysevent_in_email_action/3ccfeff5c611227a0180144333c87af9",
              status: "changed" as const,
            },
          ]
        : [],
  };
}

describe("validate and the documentation", () => {
  it("names the page that cites a record the change edits, without blocking", async () => {
    const unit = unitOf("sys_script", DESCRIBED, RULE_ID);
    const deps = {
      ...governanceOf({ [GLOBAL]: { now: [unit], base: [] } }),
      documentation: documentation(),
    };
    const result = await validate(deps, { base: "HEAD" });
    expect(result.passed).toBe(true);
    expect(result.findings.filter((f) => f.ruleId === "SN-MNT-014")).toEqual([
      {
        ruleId: "SN-MNT-014",
        severity: "warn",
        title: "The change edits a documented record",
        path: "documentation/processes/incident/configure/assign.md",
        root: "workspace",
        field: null,
        line: null,
        message: `cites sys_script/${RULE_ID} (E01, E04), which ${GLOBAL}/${unit.updateName} changes`,
        evidence: "",
        why: expect.any(String),
        remediation: expect.stringContaining("snagentic docs pin"),
      },
    ]);
    expect(deps.documentation.asked).toEqual([
      [{ table: "sys_script", sysId: RULE_ID, source: `${GLOBAL}/${unit.updateName}` }],
    ]);
  });

  it("asks nothing about records when the change edits none, and reports pages out of date", async () => {
    const docs = documentation(true);
    const result = await validate({ ...governanceOf({}), documentation: docs }, { base: "HEAD" });
    expect(docs.asked).toEqual([]);
    expect(result.findings.map((f) => [f.ruleId, f.path, f.message])).toEqual([
      [
        "SN-MNT-015",
        "documentation/processes/incident/use/report.md",
        "E02 sysevent_in_email_action/3ccfeff5c611227a0180144333c87af9 is changed in the mirror",
      ],
    ]);
  });

  it("says when cited evidence is gone from the mirror", async () => {
    const docs: DocumentedRecords = {
      citing: async () => [],
      stale: async () => [
        { page: "documentation/p.md", evidence: "E01", anchor: "sys_script/x", status: "missing" },
      ],
    };
    const result = await validate({ ...governanceOf({}), documentation: docs }, { base: "HEAD" });
    expect(result.findings[0]?.message).toBe("E01 sys_script/x is gone from the mirror");
  });

  it("checks no documentation when the workspace has none", async () => {
    const unit = unitOf("sys_script", DESCRIBED, RULE_ID);
    const result = await validate(governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), {
      base: "HEAD",
    });
    const documented = result.findings.filter((f) =>
      ["SN-MNT-014", "SN-MNT-015"].includes(f.ruleId),
    );
    expect(documented).toEqual([]);
  });
});
