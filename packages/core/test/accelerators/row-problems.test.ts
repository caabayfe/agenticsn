import { describe, expect, it } from "bun:test";
import { type DataEntity, rowProblems } from "@snagentic/core";

// The Import Set API answers a row it skips with the transform's reason. pdi3 (2026-10-24): nine
// demo offerings named the schedule "24 x 7", which only On-Call Scheduling ships.

const column = (name: string, field: string, references: string | null = null) => ({
  name,
  required: false,
  references,
  field,
  domain: false,
});
const OFFERING: DataEntity = {
  entity: "offering",
  file: "offering.csv",
  table: "u_acc_imp_offering",
  target: "service_offering",
  from: null,
  key: ["name"],
  anchors: true,
  after: [],
  columns: [
    column("name", "name"),
    column("schedule", "schedule"),
    column("support_group", "support_group", "group"),
  ],
};
const rejected = (field: string, value: string) =>
  `Reference field value for service_offering.${field} rejected: ${value}`;

describe("why the instance did not take a row", () => {
  it("names the column whose reference it rejected, never the value, grouped by reason", () => {
    expect(
      rowProblems(OFFERING, [
        { key: "VPN - Remote Access", status: "skipped", message: rejected("schedule", "24 x 7") },
        { key: "ERP - Finance", status: "skipped", message: rejected("schedule", "24 x 7") },
        { key: "Printing", status: "skipped", message: rejected("support_group", "Print team") },
      ]),
    ).toEqual([
      {
        reason: "column schedule names a record service_offering.schedule does not find",
        action:
          "change schedule to name a record the instance has, or leave it empty where it is optional",
        rows: ["VPN - Remote Access", "ERP - Finance"],
      },
      {
        reason: "column support_group names a record service_offering.support_group does not find",
        action: "load the group rows it names first, or correct support_group",
        rows: ["Printing"],
      },
    ]);
  });

  it("points to the import set row for any other reason", () => {
    expect(
      rowProblems(OFFERING, [{ key: "X", status: "error", message: "Unable to resolve X for Y" }]),
    ).toEqual([
      {
        reason: "the transform failed it",
        action: "the comment on its row in u_acc_imp_offering gives the platform's reason",
        rows: ["X"],
      },
    ]);
  });
});
