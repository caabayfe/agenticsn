import { describe, expect, it } from "bun:test";
import { type DataEntity, validateTemplates } from "@snagentic/core";

const entity = (
  name: string,
  key: string[],
  columns: DataEntity["columns"],
  after: string[] = [],
): DataEntity => ({ entity: name, file: `${name}.csv`, table: `x_t_${name}`, key, after, columns });

const GROUP = entity("group", ["name"], [{ name: "name", required: true, references: null }]);
const OFFERING = entity(
  "offering",
  ["name"],
  [
    { name: "name", required: true, references: null },
    { name: "support_group", required: true, references: "group" },
    { name: "notes", required: false, references: null },
  ],
  ["group"],
);

const template = (columns: string[], rows: string[][]) => ({ columns, rows });

describe("data template validation (ADR-0026, item 3)", () => {
  it("passes templates whose mandatory fields are set and whose references resolve", () => {
    const report = validateTemplates(
      [GROUP, OFFERING],
      new Map([
        ["group", template(["name"], [["Service Desk"], ["Network"]])],
        [
          "offering",
          template(["name", "support_group", "notes"], [["Email - Standard", "Service Desk", ""]]),
        ],
      ]),
    );
    expect(report).toEqual({
      entities: [
        { entity: "group", rows: 2, problems: [] },
        { entity: "offering", rows: 1, problems: [] },
      ],
      passed: true,
    });
  });

  it("names the row by its business key and the column, never the other values", () => {
    const report = validateTemplates(
      [GROUP, OFFERING],
      new Map([
        ["group", template(["name"], [["Service Desk"]])],
        [
          "offering",
          template(
            ["name", "support_group", "notes"],
            [
              ["Email - Standard", "", "private note"],
              ["VPN - Gold", "Nobody", "private note"],
            ],
          ),
        ],
      ]),
    );
    expect(report.passed).toBe(false);
    expect(report.entities[1]?.problems).toEqual([
      "row 1 (Email - Standard): support_group is mandatory",
      "row 2 (VPN - Gold): support_group names group Nobody, which the group template does not hold",
    ]);
    expect(JSON.stringify(report)).not.toContain("private note");
  });

  it("reports a missing template, and a template without a column the pack defines", () => {
    const report = validateTemplates(
      [GROUP, OFFERING],
      new Map([["offering", template(["name"], [["Email - Standard"]])]]),
    );
    expect(report.entities).toEqual([
      { entity: "group", rows: 0, problems: ["group.csv is missing"] },
      { entity: "offering", rows: 1, problems: ["support_group: the template has no such column"] },
    ]);
  });

  it("reports rows that repeat a business key", () => {
    const report = validateTemplates(
      [GROUP],
      new Map([["group", template(["name"], [["Network"], ["Network"]])]]),
    );
    expect(report.entities[0]?.problems).toEqual(["row 2 (Network): the key repeats row 1"]);
  });

  it("reports a reference to an entity the selection does not load", () => {
    const report = validateTemplates(
      [OFFERING],
      new Map([
        [
          "offering",
          template(["name", "support_group", "notes"], [["Email - Standard", "Service Desk", ""]]),
        ],
      ]),
    );
    expect(report.entities[0]?.problems).toEqual([
      "support_group references group, which this selection does not load",
    ]);
  });
});
