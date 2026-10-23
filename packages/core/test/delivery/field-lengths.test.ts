import { describe, expect, it } from "bun:test";
import { computeUnitPlan } from "@snagentic/core";
import { QUERY, scriptInclude, unitSetup } from "./unit-fixture";

const META = "m".repeat(32);
const SI_CLASS = "c".repeat(32);

// The instance's dictionary: sys_script_include extends sys_metadata, which declares sys_name.
function dictionary(tables: Record<string, Record<string, string>[]>, nameLength: string) {
  tables["sys_db_object"] = [
    { sys_id: META, name: "sys_metadata", "super_class.name": "" },
    { sys_id: SI_CLASS, name: "sys_script_include", "super_class.name": "sys_metadata" },
  ];
  tables["sys_dictionary"] = [
    {
      sys_id: "d1",
      name: "sys_script_include",
      element: "name",
      internal_type: "string",
      max_length: nameLength,
    },
    {
      sys_id: "d2",
      name: "sys_metadata",
      element: "sys_name",
      internal_type: "string",
      max_length: "12",
    },
    {
      sys_id: "d3",
      name: "sys_script_include",
      element: "script",
      internal_type: "script",
      max_length: "8",
    },
  ];
}

function created(fields: Record<string, string>) {
  const unit = scriptInclude("New.", "b".repeat(32));
  return { ...unit, head: { ...unit.head, fields: { ...unit.head.fields, ...fields } } };
}

describe("plan refuses a value the instance would cut (spec 011, I11)", () => {
  it("refuses a value longer than its field, naming the field and both lengths", async () => {
    const { deps, builds, project, tables } = unitSetup();
    dictionary(tables, "10");
    const unit = created({ name: "AVeryLongScriptIncludeName" });
    builds.set(project.path, [...(builds.get(project.path) ?? []), unit]);
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([
      {
        project: project.path,
        updateName: unit.updateName,
        kind: "unsafe",
        reason:
          "sys_script_include.name is 26 characters and the instance keeps 10: it would cut the value; shorten it",
      },
    ]);
    expect(plan.units.map((u) => u.updateName)).not.toContain(unit.updateName);
    expect(plan.ready).toBe(false);
  });

  it("checks a field the table inherits from its parent", async () => {
    const { deps, builds, project, tables } = unitSetup();
    dictionary(tables, "100");
    const unit = created({ sys_name: "ThirteenChars" });
    builds.set(project.path, [...(builds.get(project.path) ?? []), unit]);
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems.map((p) => p.reason)).toEqual([
      "sys_script_include.sys_name is 13 characters and the instance keeps 12: it would cut the value; shorten it",
    ]);
  });

  it("leaves long string fields unchecked: the instance keeps more than they declare", async () => {
    // pdi2: par_dashboard_canvas.layout declares 8,000 and shipped dashboards hold 71,666.
    const { deps, builds, project, tables } = unitSetup();
    dictionary(tables, "8000");
    const unit = created({ name: "x".repeat(10_757) });
    builds.set(project.path, [...(builds.get(project.path) ?? []), unit]);
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
  });

  it("plans values within their fields, and leaves script fields unchecked", async () => {
    const { deps, builds, project, tables } = unitSetup();
    dictionary(tables, "10");
    const unit = created({ name: "Short", script: "a script longer than eight" });
    builds.set(project.path, [...(builds.get(project.path) ?? []), unit]);
    const { plan } = await computeUnitPlan(deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.units.map((u) => u.updateName)).toContain(unit.updateName);
  });
});
