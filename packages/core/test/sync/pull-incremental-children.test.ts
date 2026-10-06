import { describe, expect, it } from "bun:test";
import { pulledInstance, SECTION, sid, touch, WORKFLOW } from "../support/incremental-fixture";

describe("pullIncremental: child rows", () => {
  it("rewrites the child rows of the owners whose rows changed, reading only those owners", async () => {
    const { incremental, tables, files } = await pulledInstance();
    touch(tables["sys_ui_element"]?.[0], { element: "priority" });
    const { summary, queries } = await incremental();
    expect(summary.changedSources).toEqual(["sys_ui_element"]);
    expect(files.get(`${SECTION}.children.sys_ui_element.yaml`)).toEqual([
      expect.objectContaining({ sys_id: "e1", element: "priority" }),
      expect.objectContaining({ sys_id: "e2", element: "state" }),
    ]);
    // The change feed, then the owner's rows; each listing ends on an empty page (ADR-0016).
    expect(queries.map((query) => String(query.table))).toEqual(Array(4).fill("sys_ui_element"));
    expect(queries[2]?.query).toStartWith(`sys_ui_sectionIN${sid(4)}`);
  });

  it("finds the owners that lost rows with one grouped count, without listing the table", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_ui_element"] =
      tables["sys_ui_element"]?.filter((row) => row["sys_id"] !== "e2") ?? [];
    const { queries } = await incremental();
    expect(files.get(`${SECTION}.children.sys_ui_element.yaml`)).toEqual([
      expect.objectContaining({ sys_id: "e1" }),
    ]);
    const reads = queries.filter((query) => String(query.table) === "sys_ui_element");
    expect(reads.every((query) => /sys_updated_on>=|sys_ui_sectionIN/.test(query.query))).toBe(
      true,
    );
  });

  it("removes the child-row file of an owner left without rows", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_ui_element"] = [];
    const { summary } = await incremental();
    expect(summary.removedChildFiles).toBe(1);
    expect(files.has(`${SECTION}.children.sys_ui_element.yaml`)).toBe(false);
  });

  it("lists a whole nested family again when one of its tables changed", async () => {
    const { incremental, tables, files } = await pulledInstance();
    touch(tables["wf_activity"]?.[0], { name: "Start" });
    const { queries } = await incremental();
    expect(queries.map((query) => String(query.table))).toContain("wf_workflow_version");
    expect(files.get(`${WORKFLOW}.children.wf_activity.yaml`)).toEqual([
      expect.objectContaining({ sys_id: "a1", name: "Start" }),
    ]);
  });

  it("attaches child rows of a record created in the same pull", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_ui_section"]?.push({
      sys_id: sid(11),
      sys_class_name: "sys_ui_section",
      name: "New section",
      sys_scope: "global",
      sys_updated_on: "2026-10-05 10:30:00",
    });
    tables["sys_ui_element"]?.push({
      sys_id: "e3",
      sys_ui_section: sid(11),
      element: "x",
      sys_updated_on: "2026-10-05 10:30:00",
    });
    await incremental();
    expect(
      files.get(`global/sys_ui_section/new-section--${sid(11)}.children.sys_ui_element.yaml`),
    ).toEqual([expect.objectContaining({ sys_id: "e3" })]);
  });
});

describe("pullIncremental: child tables the user may not read", () => {
  it("names them, whether refreshed by owner or listed again", async () => {
    const { incremental, tables, deny } = await pulledInstance();
    touch(tables["sys_ui_element"]?.[0], { element: "priority" });
    touch(tables["wf_activity"]?.[0], { name: "Start" });
    deny("sys_ui_element", "wf_activity");
    const { summary } = await incremental();
    expect(summary.unreadable).toEqual(["sys_ui_element", "wf_activity"]);
  });
});

describe("pullIncremental: rows owned through other child rows", () => {
  const VARIABLES = `global/sys_hub_flow/flow--${sid(3)}.children.sys_variable_value.yaml`;

  it("attaches them to the record that owns the parent row, as a full pull does", async () => {
    const { files } = await pulledInstance();
    expect(files.get(VARIABLES)).toEqual([
      expect.objectContaining({ sys_id: "vv1" }),
      expect.objectContaining({ sys_id: "vv2" }),
    ]);
  });

  it("refreshes the owning record's rows when one of them changes", async () => {
    const { incremental, tables, files } = await pulledInstance();
    touch(tables["sys_variable_value"]?.[0], { value: "changed" });
    await incremental();
    expect(files.get(VARIABLES)).toEqual([
      expect.objectContaining({ sys_id: "vv1", value: "changed" }),
      expect.objectContaining({ sys_id: "vv2", value: "b" }),
    ]);
  });

  it("finds a deleted one by count, keeping the others", async () => {
    const { incremental, tables, files } = await pulledInstance();
    tables["sys_variable_value"] = tables["sys_variable_value"]?.slice(1) ?? [];
    await incremental();
    expect(files.get(VARIABLES)).toEqual([expect.objectContaining({ sys_id: "vv2" })]);
  });

  it("keeps them when verifying, where counts are per parent row", async () => {
    const { incremental, files } = await pulledInstance();
    const { summary } = await incremental({ verify: true });
    expect(summary.removedChildFiles).toBe(0);
    expect(files.get(VARIABLES)).toHaveLength(2);
  });
});
