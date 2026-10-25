import { describe, expect, it } from "bun:test";
import { type BuiltUnit, computeUnitPlan, pushUnits } from "@snagentic/core";
import { carrierOf } from "../../src/delivery/domain/carried";
import { QUERY, unitSetup } from "./unit-fixture";

// A new field's label: the platform creates it with the dictionary entry, so loading the same
// label changes nothing and records no update of its own (pdi4, 2026-10-25: 104 labels of new
// import tables stopped an accelerator install as "not captured").

const unit = (table: string, fields: Record<string, string>, updateName: string): BuiltUnit => ({
  updateName,
  file: `${updateName}.xml`,
  head: {
    table,
    sysId: updateName.slice(-32).padStart(32, "0"),
    action: "INSERT_OR_UPDATE",
    fields,
    referenceNames: {},
  },
  children: [],
});

const field = (element: string) =>
  unit(
    "sys_dictionary",
    { name: "u_acc_t", element, column_label: "Name", internal_type: "string" },
    `sys_dictionary_u_acc_t_${element}`,
  );

const label = (element: string, text = "Name") =>
  unit(
    "sys_documentation",
    { name: "u_acc_t", element, language: "en", label: text },
    `sys_documentation_u_acc_t_${element}_en`,
  );

// Loads every unit as the fixture's platform does, then forgets the update of each label whose
// field was loaded in the same files: the platform recorded none.
function labelsUnrecorded(context: ReturnType<typeof unitSetup>, carried: readonly string[]) {
  const load = context.deps.installer.load;
  context.deps = {
    ...context.deps,
    installer: {
      ...context.deps.installer,
      load: async (scopeId, files, updateSet, signal) => {
        await load(scopeId, files, updateSet, signal);
        const xml = context.tables["sys_update_xml"] ?? [];
        context.tables["sys_update_xml"] = xml.filter((r) => !carried.includes(r["name"] ?? ""));
      },
    },
  };
}

async function push(context: ReturnType<typeof unitSetup>) {
  const { plan } = await computeUnitPlan(context.deps, QUERY);
  return pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
}

describe("labels of fields a push creates", () => {
  it("counts a new field's label as captured with its dictionary entry", async () => {
    const context = unitSetup({ ledger: null });
    context.builds.get(context.project.path)?.push(field("u_name"), label("u_name"));
    labelsUnrecorded(context, ["sys_documentation_u_acc_t_u_name_en"]);
    const pushed = await push(context);
    const doc = pushed.units.find((u) => u.updateName === "sys_documentation_u_acc_t_u_name_en");
    expect(doc).toMatchObject({ captured: true, applied: true });
    expect(pushed.notCaptured).toBe(0);
  });

  it("still reports a label whose field was not loaded in the same push", async () => {
    const context = unitSetup({ ledger: null });
    context.builds.get(context.project.path)?.push(label("u_name", "Full name"));
    labelsUnrecorded(context, ["sys_documentation_u_acc_t_u_name_en"]);
    const pushed = await push(context);
    expect(pushed.notCaptured).toBe(1);
  });
});

describe("the update that carries a label", () => {
  it("is the field's dictionary entry, or the table's collection entry for its own label", () => {
    expect(carrierOf(label("u_name"))).toBe("sys_dictionary_u_acc_t_u_name");
    expect(carrierOf(label(""))).toBe("sys_dictionary_u_acc_t_null");
    expect(carrierOf(field("u_name"))).toBeNull();
  });
});
