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

const ID = "b0ce1c6d1d0a13878244c122d6a777b2";
const [A, B] = ["a".repeat(32), "b".repeat(32)];
const PULLED_AT = "2026-10-13 18:51:36";
const QUERY = { instance: "dev", allowCollisions: false, confirm: true };

interface Kind {
  readonly table: string;
  readonly rows: string;
  readonly parent: string;
  readonly folder: string;
  readonly fields: Record<string, string>;
  readonly row: (sysId: string, position: string) => Record<string, string>;
  readonly updateName: string;
}

const LIST: Kind = {
  table: "sys_ui_list",
  rows: "sys_ui_list_element",
  parent: "list_id",
  folder: "global/sys_ui_list/incident",
  fields: {
    name: "incident",
    view: "Default view",
    parent: "",
    relationship: "",
    element: "",
    sys_user: "",
  },
  row: (sysId, position) => ({ element: sysId === A ? "number" : "state", position }),
  updateName: "sys_ui_list_incident_null",
};
const SECTION: Kind = {
  table: "sys_ui_section",
  rows: "sys_ui_element",
  parent: "sys_ui_section",
  folder: "global/sys_ui_section/incident",
  fields: { name: "incident", caption: "", view: "Default view", sys_user: "" },
  row: (sysId, position) => ({ element: sysId === A ? "number" : "state", position, type: "" }),
  updateName: `sys_ui_section_${ID}`,
};
const RELATED: Kind = {
  table: "sys_ui_related_list",
  rows: "sys_ui_related_list_entry",
  parent: "list_id",
  folder: "global/sys_ui_related_list/incident",
  fields: { name: "incident", view: "Default view", sys_user: "" },
  row: (sysId, position) => ({
    related_list: sysId === A ? "task.parent" : "sys_audit.documentkey",
    position,
  }),
  updateName: "sys_ui_related_incident_null",
};

const pulledRow = (kind: Kind, sysId: string, position: string) => ({
  sys_id: sysId,
  [kind.parent]: ID,
  ...kind.row(sysId, position),
  sys_mod_count: "0",
  sys_updated_on: PULLED_AT,
});

function layoutSetup(
  kind: Kind,
  options: { mirrored?: boolean; instanceRows?: Row[]; recreate?: boolean } = {},
) {
  const mirrored = options.mirrored ?? true;
  const base = `${kind.folder}--${ID}`;
  const rowsFile = `${base}.children.${kind.rows}.yaml`;
  const layout = record(kind.table, ID, kind.fields);
  const pulled = [pulledRow(kind, A, "0"), pulledRow(kind, B, "1")];
  const start = setup({
    mirror: { ...setup().state.mirror, ...(mirrored ? { [base]: layout } : {}) },
    working: { ...setup().state.working, [base]: layout },
    documents: {
      mirror: mirrored ? { [rowsFile]: pulled } : {},
      working: {
        [rowsFile]: [
          { ...pulled[1], position: "0" },
          { ...pulled[0], position: "2" },
        ],
      },
    },
    changed: [rowsFile],
  });
  start.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin" }];
  start.tables[kind.table] = [{ sys_id: ID, sys_mod_count: "", sys_updated_on: "" }];
  start.tables[kind.rows] = options.instanceRows ?? pulled.map((r) => ({ ...r }));
  const calls: string[] = [];
  const loaded: string[] = [];
  // fluent/load records the update in the target set, as pdi2 did (spikes S14, S15); a related
  // lists update makes the platform recreate the list under new sys_ids.
  const installer: FluentInstaller = {
    load: async (scopeId, files, updateSet) => {
      calls.push(`fluent load ${scopeId} ${files.map((f) => f.name)} into ${updateSet}`);
      loaded.push(...files.map((f) => f.content));
      if (options.recreate === true) {
        start.tables[kind.table] = [{ sys_id: "9".repeat(32) }];
      }
      const name = files[0]?.name.replace(/\.xml$/, "") ?? "";
      start.tables["sys_update_xml"] = [
        ...(start.tables["sys_update_xml"] ?? []),
        { sys_id: "xl", name, update_set: updateSet, sys_updated_by: "admin" },
      ];
    },
    publish: async () => [],
  };
  let stored: PushJournal | null = null;
  const deps: PushDependencies = {
    ...start.deps,
    reader: start.fake.reader,
    writer: memoryWriter(start.tables, calls),
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
  return { ...start, deps, calls, loaded, path: `${base}.yaml` };
}

describe("push, layouts (ADR-0029, ADR-0030)", () => {
  for (const kind of [LIST, SECTION, RELATED]) {
    it(`loads a ${kind.table} whole into the batch, writes no row, and finds it captured`, async () => {
      const { deps, calls, loaded, path } = layoutSetup(kind, { recreate: kind === RELATED });
      const { plan } = await computePlan(deps, QUERY);
      expect(plan.ready).toBe(true);
      const result = await push(deps, { ...QUERY, planId: plan.planId });
      expect(calls.filter((c) => c.includes(kind.rows) || c.startsWith("fluent"))).toEqual([
        `fluent load global ${kind.updateName}.xml into s2`,
      ]);
      expect(loaded[0]?.indexOf(B)).toBeLessThan(loaded[0]?.lastIndexOf(A) ?? 0);
      expect(loaded[0]).toContain("2026-10-06 12:00:00");
      expect(result.written).toContainEqual({
        operation: "update",
        table: kind.table,
        sysId: ID,
        path,
        captured: true,
        elevated: false,
      });
      expect(result.notCaptured).toBe(0);
    });
  }

  it("stops before loading when a row changed on the instance since the pull", async () => {
    const moved = [pulledRow(LIST, A, "0"), { ...pulledRow(LIST, B, "1"), sys_mod_count: "1" }];
    const { deps, calls } = layoutSetup(LIST, { instanceRows: moved });
    const { plan } = await computePlan(deps, QUERY);
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toMatchObject({
      code: "record-changed-on-instance",
    });
    expect(calls.some((c) => c.startsWith("fluent load"))).toBe(false);
  });

  it("stops before loading a new layout the instance already has", async () => {
    const { deps, calls } = layoutSetup(SECTION, { mirrored: false });
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.layouts[0]?.operation).toBe("create");
    await expect(push(deps, { ...QUERY, planId: plan.planId })).rejects.toMatchObject({
      code: "record-changed-on-instance",
    });
    expect(calls.some((c) => c.startsWith("fluent load"))).toBe(false);
  });

  it("refuses to push a layout without the Fluent load endpoint", async () => {
    const { deps } = layoutSetup(LIST);
    const { plan } = await computePlan(deps, QUERY);
    await expect(
      push({ ...deps, fluentInstaller: null }, { ...QUERY, planId: plan.planId }),
    ).rejects.toMatchObject({ code: "fluent-load-unavailable" });
  });

  it("checks every layout before the first load, so a load that changes another one does not stop the push", async () => {
    // As pdi2 does: loading a new section adds it to its form, which this push loads next.
    const run = layoutSetup(LIST);
    const OTHER = "d".repeat(32);
    const base = `global/sys_ui_list/problem--${OTHER}`;
    const rowsFile = `${base}.children.sys_ui_list_element.yaml`;
    const other = record("sys_ui_list", OTHER, { ...LIST.fields, name: "problem" });
    const otherRow = {
      sys_id: "e".repeat(32),
      list_id: OTHER,
      element: "number",
      position: "0",
      sys_mod_count: "0",
      sys_updated_on: PULLED_AT,
    };
    run.state.mirror[base] = other;
    run.state.working[base] = other;
    run.state.documents.mirror[rowsFile] = [otherRow];
    run.state.documents.working[rowsFile] = [{ ...otherRow, position: "1" }];
    run.state.changed.push(rowsFile);
    run.tables["sys_ui_list"] = [
      ...(run.tables["sys_ui_list"] ?? []),
      { sys_id: OTHER, sys_mod_count: "", sys_updated_on: "" },
    ];
    run.tables["sys_ui_list_element"] = [
      ...(run.tables["sys_ui_list_element"] ?? []),
      { ...otherRow },
    ];
    const load = run.deps.fluentInstaller?.load;
    const deps: PushDependencies = {
      ...run.deps,
      fluentInstaller: {
        publish: async () => [],
        load: async (scopeId, files, updateSet, signal) => {
          await load?.(scopeId, files, updateSet, signal);
          run.tables["sys_ui_list_element"] = (run.tables["sys_ui_list_element"] ?? []).map((r) =>
            r["list_id"] === OTHER ? { ...r, sys_mod_count: "1" } : r,
          );
        },
      },
    };
    const { plan } = await computePlan(deps, QUERY);
    const result = await push(deps, { ...QUERY, planId: plan.planId });
    expect(result.written.filter((w) => w.table === "sys_ui_list")).toHaveLength(2);
  });
});
