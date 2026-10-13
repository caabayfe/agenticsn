import { describe, expect, it } from "bun:test";
import type { Row } from "@snagentic/core";
import { BEFORE, pulledInstance, sid, touch } from "../support/incremental-fixture";

// Tables become records of their own (sys_db_object is sys_metadata on an instance), so choices
// have a file to attach to.
function tablesAsRecords(tables: Record<string, Row[]>): void {
  const ids = new Map(
    (tables["sys_db_object"] ?? []).map((row, i) => [row["sys_id"], sid(100 + i)]),
  );
  const rows: Row[] = (tables["sys_db_object"] ?? []).map((row) => ({
    ...row,
    sys_id: ids.get(row["sys_id"]) ?? "",
    super_class: ids.get(row["super_class"]) ?? "",
    sys_class_name: "sys_db_object",
    sys_scope: "global",
    sys_updated_on: BEFORE,
  }));
  rows.push({
    sys_id: sid(120),
    name: "sys_db_object",
    super_class: sid(100),
    sys_class_name: "sys_db_object",
    sys_scope: "global",
    sys_updated_on: BEFORE,
  });
  tables["sys_db_object"] = rows;
  tables["sys_choice"] = [
    choice("ch2", "sys_script", "when", "after"),
    choice("ch1", "sys_script", "when", "before"),
    choice("ch3", "wf_workflow", "state", "draft"),
    choice("ch4", "no_such_table", "state", "x"),
  ];
}

const choice = (sysId: string, name: string, element: string, value: string): Row => ({
  sys_id: sysId,
  name,
  element,
  value,
  label: value,
  sys_updated_on: BEFORE,
});

const SCRIPT_CHOICES = `global/sys_db_object/sys-script--${sid(101)}.children.sys_choice.yaml`;

describe("pull: choices (ADR-0025)", () => {
  it("attaches each choice to the record of the table it names, sorted by sys_id", async () => {
    const { files } = await pulledInstance(tablesAsRecords);
    expect(files.get(SCRIPT_CHOICES)).toEqual([
      expect.objectContaining({ sys_id: "ch1", element: "when", value: "before" }),
      expect.objectContaining({ sys_id: "ch2", value: "after" }),
    ]);
    expect(
      files.get(`global/sys_db_object/wf-workflow--${sid(104)}.children.sys_choice.yaml`),
    ).toEqual([expect.objectContaining({ sys_id: "ch3" })]);
  });

  it("refreshes the choices of a table whose choices changed, reading them by table name", async () => {
    const { incremental, tables, files } = await pulledInstance(tablesAsRecords);
    touch(tables["sys_choice"]?.[0], { label: "After insert" });
    const { queries } = await incremental();
    expect(files.get(SCRIPT_CHOICES)).toEqual([
      expect.objectContaining({ sys_id: "ch1" }),
      expect.objectContaining({ sys_id: "ch2", label: "After insert" }),
    ]);
    expect(queries.some((query) => query.query.startsWith("nameINsys_script"))).toBe(true);
  });

  it("lists every choice when the last pull did not read them, as before an upgrade", async () => {
    const { incremental, state, files } = await pulledInstance(tablesAsRecords);
    const fingerprints = { ...state.saved.state?.fingerprints };
    delete fingerprints["sys_choice"];
    files.delete(SCRIPT_CHOICES);
    if (state.saved.state !== null) {
      state.saved.state = { ...state.saved.state, fingerprints };
    }
    await incremental();
    expect(files.get(SCRIPT_CHOICES)).toHaveLength(2);
  });
});
