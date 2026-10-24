import { describe, expect, it } from "bun:test";
import { fieldIssues } from "@snagentic/core";
import { activations, missingFields, notesOf } from "../../src/registry/accelerator-install-view";

// The text output groups missing platform fields by field: pdi3 lacks incident.problem_id, which
// two modules read (2026-10-24).

const check = (
  module: string,
  field: string,
  state: "present" | "missing",
  note: string | null,
) => ({
  table: "incident",
  field,
  from: "com.snc.incident",
  whenMissing: note === null ? ("stop" as const) : ("warn" as const),
  note,
  module,
  state,
});

describe("missing fields in the install's text output", () => {
  it("lists each missing field once, with every module that reads it and what it loses", () => {
    expect(
      missingFields([
        check("incident-problem", "problem_id", "missing", "linked as first reported"),
        check("major-incident", "problem_id", "missing", null),
        check("incident-core", "parent_incident", "present", null),
      ]),
    ).toEqual([
      {
        field: "incident.problem_id",
        from: "com.snc.incident",
        blocking: true,
        modules: [
          { module: "incident-problem", effect: "linked as first reported" },
          { module: "major-incident", effect: null },
        ],
      },
    ]);
  });

  it("keeps the other warnings apart, and names only the plugins it activates", () => {
    const fields = [check("incident-problem", "problem_id", "missing", "linked as first reported")];
    const warnings = [...fieldIssues(fields).warnings, "tested on australia only"];
    expect(warnings).toHaveLength(2);
    const notes = notesOf({ fields, warnings });
    expect(notes).toEqual(["tested on australia only"]);
    const component = (id: string, action: "activate" | "none") => ({
      kind: "plugin" as const,
      id,
      state: "inactive" as const,
      version: null,
      minVersion: null,
      entitlement: "licensed" as const,
      modules: ["incident-analytics"],
      action,
      reason: "",
    });
    expect(
      activations([component("com.snc.pa.premium", "activate"), component("com.snc.pa", "none")]),
    ).toEqual([{ id: "com.snc.pa.premium", modules: ["incident-analytics"] }]);
  });
});
