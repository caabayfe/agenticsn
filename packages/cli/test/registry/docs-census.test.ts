import { describe, expect, it } from "bun:test";
import { docsCensus } from "../../src/registry/docs-census";

const GROUP = {
  scope: "sn_comm_management",
  title: "Task Communications Management",
  records: 2,
  items: [{ kind: "Tables that refer to it", count: 2, names: ["comm_plan", "comm_task"] }],
};

describe("docs census", () => {
  it("prints each application, the features claiming it, and what is undecided", () => {
    const output = {
      process: "incident",
      tables: ["incident", "incident_task"],
      groups: [{ ...GROUP, features: ["communication-plans"] }],
      undecided: [GROUP],
      declared: true,
    };
    expect(docsCensus.render(output, "text")).toBe(
      [
        "census of incident (incident, incident_task): 1 applications",
        "",
        "Task Communications Management (sn_comm_management): 2 records  → communication-plans",
        "  Tables that refer to it (2): comm_plan, comm_task",
        "",
        "undecided (claim each in features.yaml, as <scope> or <scope>:<name>):",
        "  sn_comm_management  Tables that refer to it: comm_plan, comm_task",
      ].join("\n"),
    );
    expect(docsCensus.render({ ...output, undecided: [] }, "text")).toContain(
      "every application has a decision in features.yaml",
    );
    const names = Array.from({ length: 8 }, (_, index) => `n${index}`);
    const first = {
      ...output,
      declared: false,
      groups: [{ ...GROUP, features: [], items: [{ kind: "K", count: 8, names }] }],
    };
    const text = docsCensus.render(first, "text");
    expect(text).toContain("K (8): n0, n1, n2, n3, n4, n5, … 2 more");
    expect(text).toContain("next: write documentation/processes/incident/features.yaml");
    expect(docsCensus.exitCode(output)).toBe(0);
  });
});
