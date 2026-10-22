import { describe, expect, it } from "bun:test";
import { deliveredDetail, earlierSets, recordedSets } from "@snagentic/core";

// ADR-0038, section 6 (proposed amendment, 2026-10-22): an upgrade completes the pack's update
// sets from older versions still in progress, so they are promoted before the new ones.

const naming = {
  pack: "itsm",
  version: "0.3.1",
  labels: ["ITSM accelerator: incident core", "ITSM accelerator: major incident"],
  recorded: [],
};

const open = (name: string, parent = "") => ({ sysId: `id ${name}`, name, parent });

describe("the pack's earlier update sets (ADR-0038, section 6)", () => {
  it("finds an older version's upgrade set and module sets", () => {
    const sets = [
      open("snagentic: itsm 0.1.0 upgrade"),
      open("snagentic: ITSM accelerator: incident core 0.1.0"),
    ];
    expect(earlierSets(naming, sets).map((s) => s.name)).toEqual([
      "snagentic: ITSM accelerator: incident core 0.1.0",
      "snagentic: itsm 0.1.0 upgrade",
    ]);
  });

  it("lists parents only: completing a parent completes its scope children (spike S-U)", () => {
    const parent = open("snagentic: itsm 0.1.0 upgrade");
    const child = open("snagentic: itsm 0.1.0 upgrade [sn_sow_inc]", parent.sysId);
    expect(earlierSets(naming, [parent, child])).toEqual([parent]);
  });

  it("orders them oldest version first, the order to promote them in", () => {
    const sets = [
      open("snagentic: itsm 0.3.0 upgrade"),
      open("snagentic: itsm 0.1.1 upgrade"),
      open("snagentic: itsm 0.1.0 upgrade"),
    ];
    expect(earlierSets(naming, sets).map((s) => s.name)).toEqual([
      "snagentic: itsm 0.1.0 upgrade",
      "snagentic: itsm 0.1.1 upgrade",
      "snagentic: itsm 0.3.0 upgrade",
    ]);
  });

  it("leaves this version's sets open: a resumed or repeated install still uses them", () => {
    const sets = [
      open("snagentic: itsm 0.3.1 upgrade"),
      open("snagentic: ITSM accelerator: major incident 0.3.1"),
    ];
    expect(earlierSets(naming, sets)).toEqual([]);
  });

  it("leaves a newer version's sets alone: installing an older pack is a downgrade", () => {
    expect(earlierSets(naming, [open("snagentic: itsm 0.4.0 upgrade")])).toEqual([]);
  });

  it("leaves sets that are not the pack's: another pack, a manual push, a label that only starts alike", () => {
    const sets = [
      open("snagentic: itsm-extra 0.1.0 upgrade"),
      open("snagentic: ACC itsm/foundation 0.1.0"),
      open("snagentic: ITSM accelerator: incident core extra 0.1.0"),
      open("itsm 0.1.0 upgrade"),
      open("snagentic: itsm upgrade"),
    ];
    expect(earlierSets(naming, sets)).toEqual([]);
  });

  it("finds a renamed module's older set through the install reports", () => {
    const renamed = open("snagentic: ITSM accelerator: incident basics 0.1.0");
    expect(earlierSets(naming, [renamed])).toEqual([]);
    const recorded = ["snagentic: ITSM accelerator: incident basics 0.1.0 [sn_sow_inc]"];
    expect(earlierSets({ ...naming, recorded }, [renamed])).toEqual([renamed]);
  });
});

describe("the update sets an install report records", () => {
  it("reads back the sets each delivered step names, scope children included", () => {
    const report = [
      "| Step | Outcome | Detail | Seconds |",
      "|---|---|---|---|",
      `| module major-incident | done | ${deliveredDetail(3, ["snagentic: ITSM accelerator: major incident 0.3.0", "snagentic: ITSM accelerator: major incident 0.3.0 [sn_sow_inc]"])} | 126.1 |`,
      `| modules already installed: foundation | done | ${deliveredDetail(1, ["snagentic: itsm 0.1.0 upgrade"])} | 57 |`,
      "| module foundation | skipped | the instance already holds it as built | 14 |",
    ].join("\n");
    expect(recordedSets(report)).toEqual([
      "snagentic: ITSM accelerator: major incident 0.3.0",
      "snagentic: ITSM accelerator: major incident 0.3.0 [sn_sow_inc]",
      "snagentic: itsm 0.1.0 upgrade",
    ]);
  });

  it("reads the reports earlier versions wrote", () => {
    const row =
      "| modules already installed: foundation, incident-core | done | 19 unit(s) into snagentic: itsm 0.1.0 upgrade, snagentic: itsm 0.1.0 upgrade [sn_sow_inc] | 80.8 |";
    expect(recordedSets(row)).toEqual([
      "snagentic: itsm 0.1.0 upgrade",
      "snagentic: itsm 0.1.0 upgrade [sn_sow_inc]",
    ]);
  });
});
