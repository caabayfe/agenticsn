import { describe, expect, it } from "bun:test";
import type { Row } from "@snagentic/core";
import { BEFORE, CHANGED, pulledInstance, sid } from "../support/incremental-fixture";

// The platform's related list editor, and loading a "Related Lists" update, replaces a form's
// related lists record under a new sys_id without a deletion record (ADR-0030, spike S15).

const related = (n: number, updatedOn = BEFORE): Row => ({
  sys_id: sid(n),
  sys_class_name: "sys_ui_related_list",
  name: "task",
  sys_name: "Task - Default view",
  view: "Default view",
  sys_scope: "global",
  sys_updated_on: updatedOn,
});

const withRelatedLists = (tables: Record<string, Row[]>) => {
  tables["sys_db_object"]?.push({ sys_id: "c6", name: "sys_ui_related_list", super_class: "c0" });
  tables["sys_ui_related_list"] = [related(7)];
};

const FOLDER = "global/sys_ui_related_list";

describe("pullIncremental: replaced related lists (ADR-0030)", () => {
  it("removes the related lists record a new one replaced, which the instance no longer has", async () => {
    const { incremental, tables, files } = await pulledInstance(withRelatedLists);
    expect(files.has(`${FOLDER}/task-default-view--${sid(7)}.yaml`)).toBe(true);
    tables["sys_ui_related_list"] = [related(8, CHANGED)];
    const { summary, queries } = await incremental();
    expect(files.has(`${FOLDER}/task-default-view--${sid(8)}.yaml`)).toBe(true);
    expect(files.has(`${FOLDER}/task-default-view--${sid(7)}.yaml`)).toBe(false);
    expect(summary.deleted).toBe(1);
    expect(queries.filter((q) => q.query.startsWith(`sys_idIN${sid(7)}`))).toHaveLength(1);
  });

  it("keeps a record of the same name the instance still has", async () => {
    const { incremental, tables, files } = await pulledInstance(withRelatedLists);
    tables["sys_ui_related_list"]?.push(related(8, CHANGED));
    await incremental();
    expect(files.has(`${FOLDER}/task-default-view--${sid(7)}.yaml`)).toBe(true);
    expect(files.has(`${FOLDER}/task-default-view--${sid(8)}.yaml`)).toBe(true);
  });

  it("asks nothing more when no related lists record was created", async () => {
    const { incremental, tables } = await pulledInstance(withRelatedLists);
    tables["sys_ui_related_list"] = [{ ...related(7), sys_updated_on: CHANGED, filter: "x" }];
    const { queries } = await incremental();
    expect(queries.filter((q) => q.query.startsWith("sys_idIN"))).toEqual([]);
  });
});
