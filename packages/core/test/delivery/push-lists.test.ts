import { describe, expect, it } from "bun:test";
import {
  computePlan,
  type FluentInstaller,
  type PushDependencies,
  type PushJournal,
  push,
  type Row,
} from "@snagentic/core";
import { record, setup } from "../support/delivery-fixture";
import { memoryWriter } from "../support/fake-instance";

const LIST_ID = "b0ce1c6d1d0a13878244c122d6a777b2";
const LIST = `global/sys_ui_list/incident--${LIST_ID}`;
const COLUMNS = `${LIST}.children.sys_ui_list_element.yaml`;
const UPDATE_NAME = "sys_ui_list_incident_null";
const [NUMBER, STATE] = ["a".repeat(32), "b".repeat(32)];
const PULLED_AT = "2026-10-13 18:51:36";

const list = () =>
  record("sys_ui_list", LIST_ID, {
    name: "incident",
    view: "Default view",
    parent: "",
    relationship: "",
    element: "",
    sys_user: "",
  });
const row = (sysId: string, element: string, position: string) => ({
  sys_id: sysId,
  list_id: LIST_ID,
  element,
  position,
  sys_mod_count: "0",
  sys_updated_on: PULLED_AT,
});
const PULLED = [row(NUMBER, "number", "0"), row(STATE, "state", "1")];

function listSetup(options: { mirrored?: boolean; instanceColumns?: Row[] } = {}) {
  const mirrored = options.mirrored ?? true;
  const base = setup({
    mirror: { ...setup().state.mirror, ...(mirrored ? { [LIST]: list() } : {}) },
    working: { ...setup().state.working, [LIST]: list() },
    documents: {
      mirror: mirrored ? { [COLUMNS]: PULLED } : {},
      working: { [COLUMNS]: [PULLED[1], { ...PULLED[0], position: "2" }] },
    },
    changed: [COLUMNS],
  });
  base.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin" }];
  base.tables["sys_ui_list"] = [
    { sys_id: LIST_ID, sys_mod_count: "", sys_updated_on: "", sys_update_name: UPDATE_NAME },
  ];
  base.tables["sys_ui_list_element"] =
    options.instanceColumns ?? PULLED.map((r) => ({ ...r, sys_mod_count: "0" }));
  const calls: string[] = [];
  const loaded: string[] = [];
  // fluent/load records the list layout in the target update set, as pdi2 did (spike S14).
  const installer: FluentInstaller = {
    load: async (scopeId, files, updateSet) => {
      calls.push(`fluent load ${scopeId} ${files.map((f) => f.name)} into ${updateSet}`);
      loaded.push(...files.map((f) => f.content));
      const name = files[0]?.name.replace(/\.xml$/, "") ?? "";
      base.tables["sys_update_xml"] = [
        ...(base.tables["sys_update_xml"] ?? []),
        { sys_id: "xl", name, update_set: updateSet, sys_updated_by: "admin" },
      ];
    },
    publish: async () => [],
  };
  let stored: PushJournal | null = null;
  const deps: PushDependencies = {
    ...base.deps,
    reader: base.fake.reader,
    writer: memoryWriter(base.tables, calls),
    journal: {
      read: async () => stored,
      write: async (journal) => {
        stored = journal;
      },
      clear: async () => {
        stored = null;
      },
    },
    catalog: { parents: {}, scopes: {}, typedFields: {} },
    username: "admin",
    url: "https://dev.example.com",
    pullRequests: {
      find: async () => ({ kind: "none" }),
      defaultBranch: async () => "main",
      openDraft: async () => "",
    },
    elevatedSessions: null,
    fluentInstaller: installer,
  };
  return { ...base, deps, calls, loaded };
}

const QUERY = { instance: "dev", allowCollisions: false, confirm: true };

describe("push, list layouts (ADR-0029)", () => {
  it("loads the whole list into the batch, writes no column row, and finds it captured", async () => {
    const { deps, calls, loaded } = listSetup();
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.ready).toBe(true);
    const result = await push(deps, { ...QUERY, planId: plan.planId });
    expect(calls.filter((c) => c.includes("sys_ui_list"))).toEqual([
      `fluent load global ${UPDATE_NAME}.xml into s2`,
    ]);
    expect(loaded[0]?.indexOf("<element>state</element>")).toBeLessThan(
      loaded[0]?.indexOf("<element>number</element>") ?? 0,
    );
    expect(result.written).toContainEqual({
      operation: "update",
      table: "sys_ui_list",
      sysId: LIST_ID,
      path: `${LIST}.yaml`,
      captured: true,
      elevated: false,
    });
    expect(result.notCaptured).toBe(0);
  });

  it("stops before loading when a column changed on the instance since the pull", async () => {
    const moved = PULLED.map((r) => ({ ...r, sys_mod_count: r.sys_id === STATE ? "1" : "0" }));
    const { deps, calls } = listSetup({ instanceColumns: moved });
    const { plan } = await computePlan(deps, QUERY);
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toMatchObject({
      code: "record-changed-on-instance",
    });
    expect(calls.some((c) => c.startsWith("fluent load"))).toBe(false);
  });

  it("stops before loading a new list the instance already has", async () => {
    const { deps, calls } = listSetup({ mirrored: false });
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.lists[0]?.operation).toBe("create");
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toMatchObject({
      code: "record-changed-on-instance",
    });
    expect(calls.some((c) => c.startsWith("fluent load"))).toBe(false);
  });

  it("refuses to push a list without the Fluent load endpoint", async () => {
    const { deps } = listSetup();
    const { plan } = await computePlan(deps, QUERY);
    await expect(
      push({ ...deps, fluentInstaller: null }, { ...QUERY, planId: plan.planId }),
    ).rejects.toMatchObject({ code: "list-load-unavailable" });
  });
});
