import { describe, expect, it } from "bun:test";
import { computePlan, type PushDependencies, type PushJournal, push } from "@snagentic/core";
import { NEW, RULE, record, type State, setup } from "../support/delivery-fixture";
import { memoryWriter } from "../support/fake-instance";

const SYS_ID = "0123456789abcdef0123456789abcdef";

function memoryJournal() {
  let stored: PushJournal | null = null;
  const history: PushJournal[] = [];
  return {
    history,
    get current() {
      return stored;
    },
    store: {
      read: async () => stored,
      write: async (journal: PushJournal) => {
        stored = journal;
        history.push(journal);
      },
      clear: async () => {
        stored = null;
      },
    },
  };
}

function pushSetup(overrides: Partial<State> = {}, options = { capture: true }) {
  const base = setup(overrides);
  base.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin" }];
  base.tables["sys_script"] = [
    {
      sys_id: SYS_ID,
      sys_class_name: "sys_script",
      sys_scope: "global",
      name: "Rule",
      order: "100",
      script: "a();",
    },
  ];
  const calls: string[] = [];
  const writer = memoryWriter(base.tables, calls, { on: options.capture });
  const journal = memoryJournal();
  const deps: PushDependencies = {
    ...base.deps,
    reader: base.fake.reader,
    writer,
    journal: journal.store,
    catalog: { parents: {}, scopes: {}, typedFields: {} },
    username: "admin",
    url: "https://dev.example.com",
  };
  return { ...base, deps, calls, journal };
}

const QUERY = { instance: "dev", allowCollisions: false, confirm: true };
const planned = async (deps: PushDependencies) => (await computePlan(deps, QUERY)).plan.planId;

describe("push", () => {
  it("writes the plan into the branch's update set, verifies capture and restores the user's update set", async () => {
    const { deps, calls, journal, tables } = pushSetup();
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(result).toMatchObject({
      updateSets: [
        {
          scope: "global",
          name: "snagentic: feature/p1 [global]",
          sysId: "s2",
          created: false,
          link: "https://dev.example.com/sys_update_set.do?sys_id=s2",
        },
      ],
      written: [
        {
          operation: "update",
          table: "sys_script",
          sysId: SYS_ID,
          path: `${RULE}.yaml`,
          captured: true,
        },
      ],
      notCaptured: 0,
      next: [
        { tool: "pull", args: { instance: "dev" } },
        { tool: "status", args: { instance: "dev" } },
      ],
    });
    expect(calls).toEqual([
      "insert sys_user_preference name,user,value",
      "update sys_script order=200",
      "update sys_user_preference value=",
    ]);
    expect(tables["sys_script"]?.[0]?.["order"]).toBe("200");
    expect(journal.current).toBeNull();
    expect(journal.history.some((j) => j.preference !== null && j.steps.length === 0)).toBe(true);
    expect(JSON.stringify(journal.history)).not.toContain('"200"');
  });

  it("creates the update set when the scope has none open, and new records with their sys_id", async () => {
    const created = record(
      "sys_script_include",
      "fedcba9876543210fedcba9876543210",
      { name: "Util" },
      "var Util;",
    );
    const { deps, calls, tables } = pushSetup({
      working: { [NEW]: created },
      changed: [`${NEW}.yaml`],
    });
    tables["sys_update_set"] = [];
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(result.updateSets[0]).toMatchObject({ created: true });
    expect(calls).toContain("insert sys_script_include name,script,sys_id,sys_scope");
    expect(result.written[0]).toMatchObject({ operation: "create", captured: true });
  });

  it("needs confirmation, the reviewed plan, and a ready plan", async () => {
    const { deps } = pushSetup();
    await expect(push(deps, { ...QUERY, confirm: false, planId: "x" })).rejects.toMatchObject({
      code: "push-confirmation-required",
    });
    await expect(push(deps, { ...QUERY, planId: "0000000000000000" })).rejects.toMatchObject({
      code: "plan-changed",
    });
    const risky = record("sys_script", SYS_ID, { name: "Rule", order: "100" }, "eval(x);");
    const blocked = pushSetup({ working: { [RULE]: risky } });
    await expect(
      push(blocked.deps, { ...QUERY, planId: await planned(blocked.deps) }),
    ).rejects.toMatchObject({ code: "plan-not-ready" });
  });

  it("stops before writing a record that changed on the instance, and restores the user's update set", async () => {
    const { deps, calls, journal, tables, state } = pushSetup();
    tables["sys_script"] = (tables["sys_script"] ?? []).map((row) => ({ ...row, order: "150" }));
    await expect(push(deps, { ...QUERY, planId: await planned(deps) })).rejects.toMatchObject({
      code: "record-changed-on-instance",
    });
    expect(calls.at(-1)).toBe("update sys_user_preference value=");
    expect(journal.current).toMatchObject({ preference: null });
    // Until a pull shows what reached the instance, the next push refuses.
    await expect(push(deps, { ...QUERY, planId: await planned(deps) })).rejects.toMatchObject({
      code: "unfinished-push",
    });
    state.mirror = { ...state.mirror };
    deps.workspace.mirrorCommit = async () => "pulled-again";
    await expect(push(deps, { ...QUERY, planId: "x" })).rejects.toMatchObject({
      code: "plan-changed",
    });
    expect(journal.current).toBeNull();
  });

  it("restores the preference an interrupted push left switched", async () => {
    const { deps, journal, calls } = pushSetup();
    await journal.store.write({
      planId: "p",
      mirrorCommit: "c0ffee",
      startedAt: "t",
      preference: { sysId: "pref1", name: "sys_update_set", previousValue: "mine" },
      steps: [],
    });
    deps.writer.update = async (table, sysId, values) => {
      calls.push(`update ${table} ${sysId} ${JSON.stringify(values)}`);
      return {};
    };
    await expect(push(deps, { ...QUERY, planId: "x" })).rejects.toMatchObject({
      code: "unfinished-push",
    });
    expect(calls).toEqual(['update sys_user_preference pref1 {"value":"mine"}']);
  });

  it("reports writes the platform did not capture in the update set", async () => {
    const { deps } = pushSetup({}, { capture: false });
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(result).toMatchObject({ notCaptured: 1, written: [{ captured: false }] });
  });

  it("refuses when the signed-in user cannot be read", async () => {
    const { deps, tables } = pushSetup();
    tables["sys_user"] = [];
    await expect(push(deps, { ...QUERY, planId: await planned(deps) })).rejects.toMatchObject({
      code: "integration-user-not-found",
    });
  });

  it("sets the update set for the signed-in user, whatever instance.yaml names (ADR-0021)", async () => {
    const { deps, tables } = pushSetup();
    const renamed = { ...deps, username: "someone_else" };
    await push(renamed, { ...QUERY, planId: await planned(deps) });
    const preference = (tables["sys_user_preference"] ?? [])[0];
    expect(preference).toMatchObject({ user: "u1", name: "sys_update_set" });
  });
});
