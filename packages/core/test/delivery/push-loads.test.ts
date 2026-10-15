import { describe, expect, it } from "bun:test";
import {
  computePlan,
  type FluentInstaller,
  type PushDependencies,
  type PushJournal,
  push,
  type TableDictionary,
} from "@snagentic/core";
import { RULE, record, setup } from "../support/delivery-fixture";
import { memoryWriter } from "../support/fake-instance";

// ADR-0030: a record of a class the platform does not record when the Table API writes it
// (update_synch=false, such as a scheduled job) is loaded as its update instead.

const JOB_ID = "9f0cda40bf044c769da3299c4ca01a69";
const JOB = `x_acme_app/sysauto_script/nightly--${JOB_ID}`;
const QUERY = { instance: "dev", allowCollisions: false, confirm: true };

const DICTIONARY: TableDictionary = {
  tables: async (names) =>
    [
      { name: "sysauto_script", parent: "sysauto", attributes: "" },
      { name: "sysauto", parent: "sys_metadata", attributes: "update_synch=false" },
      { name: "sys_script", parent: "sys_metadata", attributes: "update_synch=true" },
      { name: "sys_metadata", parent: "", attributes: "" },
    ].filter((t) => names.includes(t.name)),
};

const job = (script: string, domain?: string) => {
  const files = record(
    "sysauto_script",
    JOB_ID,
    { name: "Nightly", active: "false", run_type: "daily" },
    script,
    "x_acme_app",
  );
  const document = files.document as { _meta: Record<string, unknown> };
  return domain === undefined
    ? files
    : { ...files, document: { ...document, _meta: { ...document._meta, sys_domain: domain } } };
};

function loadSetup(options: { dictionary?: boolean; domain?: string; rule?: boolean } = {}) {
  const base = setup({
    mirror: { ...setup().state.mirror, [JOB]: job("a();") },
    working: { ...setup().state.working, [JOB]: job("b();", options.domain) },
    changed: [
      ...(options.rule === true ? [`${RULE}.yaml`] : []),
      `${JOB}.yaml`,
      `${JOB}.script.js`,
    ],
  });
  base.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin" }];
  base.tables["sysauto_script"] = [
    {
      sys_id: JOB_ID,
      sys_class_name: "sysauto_script",
      name: "Nightly",
      active: "false",
      run_type: "daily",
      script: "a();",
    },
  ];
  const calls: string[] = [];
  const loaded: string[] = [];
  const installer: FluentInstaller = {
    load: async (scopeId, files, updateSet) => {
      calls.push(`fluent load ${scopeId} ${files.map((f) => f.name)} into ${updateSet}`);
      loaded.push(...files.map((f) => f.content));
      base.tables["sys_update_xml"] = [
        ...(base.tables["sys_update_xml"] ?? []),
        {
          sys_id: "xj",
          name: `sysauto_script_${JOB_ID}`,
          update_set: updateSet,
          sys_updated_by: "admin",
        },
      ];
    },
    publish: async () => [],
  };
  let stored: PushJournal | null = null;
  const deps: PushDependencies = {
    ...base.deps,
    ...(options.dictionary === false ? {} : { dictionary: DICTIONARY }),
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
    catalog: { parents: {}, scopes: { ["s".repeat(32)]: "x_acme_app" }, typedFields: {} },
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

describe("push, records the platform does not record (ADR-0030)", () => {
  it("plans a scheduled job as loaded, and a business rule as written", async () => {
    const { plan } = await computePlan(loadSetup({ rule: true }).deps, QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.changes.map((c) => [c.table, c.loaded])).toEqual([
      ["sys_script", false],
      ["sysauto_script", true],
    ]);
    expect(plan.ready).toBe(true);
  });

  it("loads the whole job into its scope's update set, and finds it captured", async () => {
    const { deps, calls, loaded } = loadSetup();
    const { plan } = await computePlan(deps, QUERY);
    const result = await push(deps, { ...QUERY, planId: plan.planId });
    const loads = calls.filter((c) => c.includes("sysauto_script"));
    expect(loads).toHaveLength(1);
    // Into the scope's own update set, a child of the batch.
    expect(loads[0]).toStartWith(
      `fluent load ${"s".repeat(32)} sysauto_script_${JOB_ID}.xml into `,
    );
    expect(loads[0]).not.toEndWith(" into s2");
    expect(loaded[0]).toContain("<script>b();</script>");
    expect(loaded[0]).toContain("<run_type>daily</run_type>");
    expect(loaded[0]).not.toContain("sys_domain");
    expect(result.written).toContainEqual(
      expect.objectContaining({ table: "sysauto_script", sysId: JOB_ID, captured: true }),
    );
    expect(result.notCaptured).toBe(0);
  });

  it("carries a domain other than global", async () => {
    const { deps, loaded } = loadSetup({ domain: "9".repeat(32) });
    const { plan } = await computePlan(deps, QUERY);
    await push(deps, { ...QUERY, planId: plan.planId });
    expect(loaded[0]).toContain(`<sys_domain>${"9".repeat(32)}</sys_domain>`);
  });

  it("binds the plan id to the loaded record", async () => {
    const first = await computePlan(loadSetup().deps, QUERY);
    const other = await computePlan(loadSetup({ domain: "9".repeat(32) }).deps, QUERY);
    expect(first.plan.planId).not.toBe(other.plan.planId);
  });

  it("writes through the Table API when the dictionary cannot be read", async () => {
    const { plan } = await computePlan(loadSetup({ dictionary: false }).deps, QUERY);
    expect(plan.changes.every((c) => !c.loaded)).toBe(true);
  });
});
