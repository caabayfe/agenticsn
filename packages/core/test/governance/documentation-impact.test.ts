import { describe, expect, it } from "bun:test";
import { type DocumentedRecords, documentationImpact } from "@snagentic/core";
import { governanceOf, unitOf } from "../support/fake-governance";

// What a change does to the documentation, claim by claim (ADR-0039).

const GLOBAL = "source/global";
const RULE_ID = "0c1345dd0783f01028ef0a701ad300fa";
const RULE = { description: "Sets the group", when: "before", script: "var a = 1;" };

const docs: DocumentedRecords = {
  citing: async (records) =>
    records
      .filter((record) => record.sysId === RULE_ID)
      .map((record) => ({
        ...record,
        page: "documentation/processes/incident/use/report.md",
        title: "Report an incident",
        evidence: ["E02"],
        claims: [{ heading: "What happens next", reader: "employees", text: "IT routes it." }],
      })),
  stale: async () => [
    {
      page: "documentation/processes/incident/configure/email.md",
      title: "Inbound email",
      evidence: "E01",
      anchor: "sysevent_in_email_action/3ccfeff5c611227a0180144333c87af9",
      status: "changed",
      claims: [{ heading: "Inbound email", reader: "platform", text: "The action reads it." }],
    },
  ],
  unanimated: async () => [],
};

describe("documentation impact", () => {
  it("names each claim a source change or an instance change may make wrong", async () => {
    const unit = unitOf("sys_script", RULE, RULE_ID);
    const deps = { ...governanceOf({ [GLOBAL]: { now: [unit], base: [] } }), documentation: docs };
    const impact = await documentationImpact(deps, { base: "origin/main" });
    expect(impact).toEqual({
      base: "origin/main",
      units: 1,
      items: [
        {
          page: "documentation/processes/incident/use/report.md",
          title: "Report an incident",
          record: `sys_script/${RULE_ID}`,
          evidence: ["E02"],
          cause: { kind: "source", files: [`${GLOBAL}/${unit.updateName}`] },
          claims: [{ heading: "What happens next", reader: "employees", text: "IT routes it." }],
        },
        {
          page: "documentation/processes/incident/configure/email.md",
          title: "Inbound email",
          record: "sysevent_in_email_action/3ccfeff5c611227a0180144333c87af9",
          evidence: ["E01"],
          cause: { kind: "instance", status: "changed" },
          claims: [{ heading: "Inbound email", reader: "platform", text: "The action reads it." }],
        },
      ],
    });
  });

  it("finds no impact in a workspace without documentation", async () => {
    const unit = unitOf("sys_script", RULE, RULE_ID);
    const deps = governanceOf({ [GLOBAL]: { now: [unit], base: [] } });
    expect((await documentationImpact(deps, { base: "HEAD" })).items).toEqual([]);
  });

  it("refuses a base that names no commit", async () => {
    const deps = { ...governanceOf({}), documentation: docs };
    await expect(documentationImpact(deps, { base: "nope" })).rejects.toThrow(/nope/);
  });
});
