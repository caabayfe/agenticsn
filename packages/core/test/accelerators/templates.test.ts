import { describe, expect, it } from "bun:test";
import { type DataEntity, stagingRow, validateTemplates } from "@snagentic/core";

const entity = (
  name: string,
  key: string[],
  columns: DataEntity["columns"],
  after: string[] = [],
): DataEntity => ({
  entity: name,
  file: `${name}.csv`,
  table: `x_t_${name}`,
  key,
  after,
  columns,
  anchors: false,
});

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

  it("accepts anchors' fixed sys_ids on an entity with anchors, and rows without one", () => {
    const anchored = { ...GROUP, anchors: true };
    const report = validateTemplates(
      [anchored],
      new Map([
        [
          "group",
          template(
            ["name", "sys_id"],
            [
              ["Service Desk", "acc0e0a1c0de4f0e9a0b1c2d3e4f5a01"],
              ["Customer group", ""],
            ],
          ),
        ],
      ]),
    );
    expect(report.passed).toBe(true);
  });

  it("reports a malformed or repeated anchor sys_id, and anchors on an entity without them", () => {
    const rows = [
      ["Service Desk", "ACC0E0A1"],
      ["Network", "acc0e0a1c0de4f0e9a0b1c2d3e4f5a01"],
      ["Servers", "acc0e0a1c0de4f0e9a0b1c2d3e4f5a01"],
    ];
    const anchored = validateTemplates(
      [{ ...GROUP, anchors: true }],
      new Map([["group", template(["name", "sys_id"], rows)]]),
    );
    expect(anchored.entities[0]?.problems).toEqual([
      "row 1 (Service Desk): sys_id must be 32 lowercase hexadecimal characters",
      "row 3 (Servers): sys_id repeats row 2",
    ]);
    const plain = validateTemplates(
      [GROUP],
      new Map([["group", template(["name", "sys_id"], rows.slice(1, 2))]]),
    );
    expect(plain.entities[0]?.problems).toEqual([
      "sys_id: this entity has no anchors (anchors: true in module.yaml), so the column would be ignored",
    ]);
  });
});

describe("the import set row a template row becomes (spike S-D)", () => {
  it("posts columns as u_<column> to a staging table created in global", () => {
    expect(
      stagingRow("u_acc_imp_group", ["name", "sys_id"], [" Service Desk ", "a".repeat(32)]),
    ).toEqual({
      u_name: "Service Desk",
      u_sys_id: "a".repeat(32),
    });
  });

  it("keeps other tables' column names, but never posts sys_id as the row's own", () => {
    expect(
      stagingRow("imp_location", ["name", "city", "sys_id"], ["HQ", "Madrid", "b".repeat(32)]),
    ).toEqual({
      name: "HQ",
      city: "Madrid",
      u_sys_id: "b".repeat(32),
    });
  });
});
