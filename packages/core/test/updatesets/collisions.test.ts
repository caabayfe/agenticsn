import { describe, expect, it } from "bun:test";
import { findCollisions } from "@snagentic/core";

const SETS = [
  { sysId: "us1", name: "Alice's work", isDefault: false },
  { sysId: "us2", name: "Bob's work", isDefault: false },
  { sysId: "def", name: "Default", isDefault: true },
];
const update = (name: string, updateSet: string, updatedOn: string, updatedBy = "alice") => ({
  name,
  updateSet,
  type: "Business Rule",
  targetName: "VIP flag",
  action: "INSERT_OR_UPDATE",
  updatedBy,
  updatedOn,
});

describe("findCollisions", () => {
  it("reports a record captured in two open update sets, oldest holder first", () => {
    const report = findCollisions(SETS, [
      update("sys_script_1", "us2", "2026-10-02 10:00:00", "bob"),
      update("sys_script_1", "us1", "2026-10-01 10:00:00"),
      update("sys_script_2", "us1", "2026-10-01 11:00:00"),
    ]);
    expect(report.openRecords).toBe(2);
    expect(report.collisions).toEqual([
      {
        record: "sys_script_1",
        type: "Business Rule",
        targetName: "VIP flag",
        holders: [
          {
            updateSet: "us1",
            updateSetName: "Alice's work",
            updatedBy: "alice",
            updatedOn: "2026-10-01 10:00:00",
            action: "INSERT_OR_UPDATE",
          },
          {
            updateSet: "us2",
            updateSetName: "Bob's work",
            updatedBy: "bob",
            updatedOn: "2026-10-02 10:00:00",
            action: "INSERT_OR_UPDATE",
          },
        ],
      },
    ]);
  });

  it("lists several collisions by record", () => {
    const report = findCollisions(SETS, [
      update("sys_script_2", "us1", "2026-10-01 10:00:00"),
      update("sys_script_2", "us2", "2026-10-01 11:00:00"),
      update("sys_script_1", "us2", "2026-10-01 10:00:00"),
      update("sys_script_1", "us1", "2026-10-01 10:00:00"),
    ]);
    expect(report.collisions.map((c) => c.record)).toEqual(["sys_script_1", "sys_script_2"]);
  });

  it("does not count two updates of one record in the same set as a collision", () => {
    const report = findCollisions(SETS, [
      update("sys_script_1", "us1", "2026-10-01 10:00:00"),
      update("sys_script_1", "us1", "2026-10-02 10:00:00"),
    ]);
    expect(report.collisions).toEqual([]);
  });

  it("counts default update sets apart: a change there means nobody holds the record", () => {
    const report = findCollisions(SETS, [
      update("sys_script_1", "def", "2026-10-01 10:00:00"),
      update("sys_script_1", "us1", "2026-10-02 10:00:00"),
    ]);
    expect(report).toEqual({ collisions: [], openRecords: 1, defaultSetRecords: 1 });
  });

  it("ignores updates of sets it was not given", () => {
    expect(findCollisions(SETS, [update("x", "closed", "2026-10-01 10:00:00")]).openRecords).toBe(
      0,
    );
  });
});
