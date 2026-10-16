import { describe, expect, it } from "bun:test";
import { computePlan } from "@snagentic/core";
import { record, setup } from "../support/delivery-fixture";

const QUERY = { instance: "dev", allowCollisions: false };
const LIST_ID = "b0ce1c6d1d0a13878244c122d6a777b2";
const LIST = `x_acme_app/sys_ui_list/x-acme-app-task--${LIST_ID}`;
const COLUMNS = `${LIST}.children.sys_ui_list_element.yaml`;
const MOBILE = "9".repeat(32);
const VIEW = `global/sys_ui_view/mobile--${MOBILE}`;

const list = (view = "Default view") =>
  record(
    "sys_ui_list",
    LIST_ID,
    { name: "x_acme_app_task", view, parent: "", relationship: "", element: "", sys_user: "" },
    undefined,
    "x_acme_app",
  );
const row = (sysId: string, element: string, position: string) => ({
  sys_id: sysId,
  list_id: LIST_ID,
  element,
  position,
  sum: "false",
  sys_mod_count: "0",
  sys_updated_on: "2026-10-13 18:51:36",
});
const PULLED = [row("a".repeat(32), "number", "0"), row("b".repeat(32), "state", "1")];

function lists(working: unknown[], changed = [COLUMNS], extra = {}) {
  const base = setup();
  return setup({
    mirror: { ...base.state.mirror, [LIST]: list() },
    working: { ...base.state.working, [LIST]: list() },
    documents: { mirror: { [COLUMNS]: PULLED }, working: { [COLUMNS]: working } },
    changed,
    ...extra,
  });
}

describe("computePlan, list layouts (ADR-0029)", () => {
  it("plans an edited list as one list change, columns in position order, not as row writes", async () => {
    const edited = [
      PULLED[1],
      row("c".repeat(32), "priority", "2"),
      { ...PULLED[0], position: "3" },
    ];
    const { plan, writes, lists: planned } = await computePlan(lists(edited).deps, QUERY);
    expect(writes).toEqual([]);
    expect(planned).toHaveLength(1);
    expect(plan).toMatchObject({
      changes: [],
      lists: [
        {
          operation: "update",
          scope: "x_acme_app",
          table: "x_acme_app_task",
          view: "Default view",
          domain: "global",
          sysId: LIST_ID,
          path: `${LIST}.yaml`,
          columns: ["state", "priority", "number"],
        },
      ],
      updateSets: ["snagentic: feature/p1", "snagentic: feature/p1 [x_acme_app]"],
      problems: [],
      ready: true,
    });
  });

  it("binds the plan id to the list's columns", async () => {
    const first = await computePlan(lists([PULLED[0]]).deps, QUERY);
    const second = await computePlan(lists([PULLED[1]]).deps, QUERY);
    expect(first.plan.planId).not.toBe(second.plan.planId);
    expect((await computePlan(lists([PULLED[0]]).deps, QUERY)).plan.planId).toBe(first.plan.planId);
  });

  it("names a view other than the default from the mirror, and refuses one it cannot find", async () => {
    const view = record("sys_ui_view", MOBILE, { name: "Mobile" });
    const base = setup();
    const planned = (mirror: Record<string, unknown>) =>
      setup({
        mirror: { ...base.state.mirror, ...mirror, [LIST]: list(MOBILE) },
        working: { ...base.state.working, [LIST]: list(MOBILE) },
        documents: { mirror: { [COLUMNS]: PULLED }, working: { [COLUMNS]: [PULLED[0]] } },
        changed: [COLUMNS],
      }).deps;
    const found = await computePlan(planned({ [VIEW]: view }), QUERY);
    expect(found.plan.lists[0]?.view).toBe("Mobile");
    expect(found.lists[0]?.updateName).toBe("sys_ui_list_x_acme_app_task_Mobile");
    const missing = await computePlan(planned({}), QUERY);
    expect(missing.plan.problems).toEqual([
      {
        path: `${LIST}.yaml`,
        reason: `the view ${MOBILE} is not in the mirror: pull, or use the Default view`,
      },
    ]);
  });

  it("is not ready when a list cannot be delivered whole", async () => {
    const { plan } = await computePlan(
      lists([{ ...PULLED[0], list_id: "e".repeat(32) }]).deps,
      QUERY,
    );
    expect(plan.ready).toBe(false);
    expect(plan.problems[0]?.reason).toContain("list_id must be");
  });
});
