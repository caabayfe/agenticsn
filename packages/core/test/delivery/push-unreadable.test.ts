import { describe, expect, it } from "bun:test";
import {
  AccessDeniedError,
  type BuiltUnit,
  computeUnitPlan,
  planUnit,
  pushUnits,
  readUnits,
  unitDigest,
} from "@snagentic/core";
import { QUERY, unitSetup } from "./unit-fixture";

// A table's database index (sys_index): the instance's REST API refuses the table to every user,
// admin included ("Failed API level ACL Validation", pdi6), so a Table that declares an index
// stopped the plan. The load and the update set still take it.

const INDEX_ID = "c".repeat(32);
const UPDATE_NAME = "sys_index_u_acc_t_u_key";

const index = (action: "INSERT_OR_UPDATE" | "DELETE" = "INSERT_OR_UPDATE"): BuiltUnit => ({
  updateName: UPDATE_NAME,
  file: `${UPDATE_NAME}.xml`,
  head: {
    table: "sys_index",
    sysId: INDEX_ID,
    action,
    fields: { logical_table_name: "u_acc_t", col_name_string: "u_key", unique_index: "true" },
    referenceNames: {},
  },
  children: [],
});

// The instance as pdi6 answers: any read of sys_index is refused.
function refusingIndexes(context: ReturnType<typeof unitSetup>) {
  const reader = context.deps.reader;
  context.deps = {
    ...context.deps,
    reader: {
      ...reader,
      query: async (query, signal) => {
        if (query.table === "sys_index") throw new AccessDeniedError("table sys_index", "refused");
        return reader.query(query, signal);
      },
    },
  };
}

// The load writes the index without recording it in the update set.
function uncaptured(context: ReturnType<typeof unitSetup>) {
  const load = context.deps.installer.load;
  context.deps = {
    ...context.deps,
    installer: {
      ...context.deps.installer,
      load: async (scopeId, files, updateSet, signal) => {
        await load(scopeId, files, updateSet, signal);
        const xml = context.tables["sys_update_xml"] ?? [];
        context.tables["sys_update_xml"] = xml.filter((r) => r["name"] !== UPDATE_NAME);
      },
    },
  };
}

function withIndex(build = index()) {
  const context = unitSetup();
  context.builds.get(context.project.path)?.push(build);
  refusingIndexes(context);
  return context;
}

async function push(context: ReturnType<typeof unitSetup>) {
  const { plan } = await computeUnitPlan(context.deps, QUERY);
  return pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true });
}

describe("units of a table the instance's REST API never serves", () => {
  it("reads no copy of a database index, and asks the instance nothing about it", async () => {
    const context = withIndex();
    const copies = await readUnits(context.deps.reader, [index()], new AbortController().signal);
    expect(copies.get(UPDATE_NAME)).toBeNull();
    expect(context.fake.queries.some((q) => q.table === "sys_index")).toBe(false);
  });

  it("plans a new index as a create instead of stopping", async () => {
    const { plan } = await computeUnitPlan(withIndex().deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.units.find((u) => u.updateName === UPDATE_NAME)?.operation).toBe("create");
  });

  it("counts an index applied once its update set captured it, and records it in the ledger", async () => {
    const context = withIndex();
    const pushed = await push(context);
    expect(pushed.units.find((u) => u.updateName === UPDATE_NAME)).toMatchObject({
      captured: true,
      applied: true,
    });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units.some((u) => u.updateName === UPDATE_NAME)).toBe(false);
  });

  it("reports an index the update set did not capture as not applied, and plans it again", async () => {
    const context = withIndex();
    uncaptured(context);
    const pushed = await push(context);
    expect(pushed.units.find((u) => u.updateName === UPDATE_NAME)).toMatchObject({
      captured: false,
      applied: false,
    });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.units.find((u) => u.updateName === UPDATE_NAME)?.operation).toBe("create");
  });

  it("refuses to delete an index, which it could not see go", () => {
    const deletion = index("DELETE");
    expect(planUnit(deletion, unitDigest(deletion), null, undefined)).toMatchObject({
      kind: "unsafe",
    });
  });
});
