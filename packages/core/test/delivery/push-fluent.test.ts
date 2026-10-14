import { describe, expect, it } from "bun:test";
import {
  computePlan,
  FlowDomainMismatchError,
  FlowPublishFailedError,
  type FluentInstaller,
  type FluentPackage,
  type PushDependencies,
  type PushJournal,
  push,
  type Row,
} from "@snagentic/core";
import { record, setup } from "../support/delivery-fixture";
import { memoryWriter } from "../support/fake-instance";

const FLOW = "f0000000000000000000000000000001";
const ACTION = "a0000000000000000000000000000001";
const ENDPOINT =
  "global/sys_ws_operation/activate-flows-and-actions--20307c3bff277610a6c4ffffffffff7e";

const built = (table: string, sysId: string, name: string, type = "") =>
  `<?xml version="1.0"?>\n<record_update table="${table}">\n  <${table} action="INSERT_OR_UPDATE">\n` +
  `    <sys_id>${sysId}</sys_id>\n    <sys_update_name>${table}_${sysId}</sys_update_name>\n` +
  `    <name>${name}</name>\n${type ? `    <type>${type}</type>\n` : ""}  </${table}>\n</record_update>\n`;

const PACKAGE: FluentPackage = {
  project: "source/global",
  scope: "global",
  scopeId: "global",
  configuration: true,
  files: [
    {
      name: `sys_hub_flow_${FLOW}.xml`,
      content: built("sys_hub_flow", FLOW, "Page on-call", "flow"),
    },
    { name: `a_${ACTION}.xml`, content: built("sys_hub_action_type_definition", ACTION, "Score") },
  ],
  digest: "d1",
};

const PUBLISHED_FLOW =
  '<record_update table="sys_hub_flow"><sys_hub_flow action="INSERT_OR_UPDATE"><status>published</status></sys_hub_flow><sys_hub_flow_snapshot action="INSERT_OR_UPDATE"/></record_update>';
const PUBLISHED_ACTION =
  '<record_update table="sys_hub_action_type_definition"><sys_hub_action_type_definition action="INSERT_OR_UPDATE"/><sys_hub_action_type_snapshot action="INSERT_OR_UPDATE"/></record_update>';

// The ServiceNow IDE's endpoints as push sees them: the publish writes each record's published
// update into the user's current update set, as the platform does (test B5).
function fakeInstaller(tables: Record<string, Row[]>, calls: string[], refuse = false) {
  const currentSet = () =>
    (tables["sys_user_preference"] ?? []).find((r) => r["name"] === "sys_update_set")?.["value"] ??
    "";
  const installer: FluentInstaller = {
    load: async (scopeId, files, updateSet) => {
      calls.push(`fluent load ${scopeId} ${files.length} files into ${updateSet}`);
    },
    publish: async (scope, records) => {
      calls.push(`fluent publish ${scope} flows=${records.flows} actions=${records.actions}`);
      if (refuse) {
        return [{ sysId: FLOW, published: false, message: "No Trigger instance found" }];
      }
      const rows = [
        {
          sys_id: "xf",
          name: `sys_hub_flow_${FLOW}`,
          update_set: currentSet(),
          payload: PUBLISHED_FLOW,
        },
        {
          sys_id: "xa",
          name: `sys_hub_action_type_definition_${ACTION}`,
          update_set: currentSet(),
          payload: PUBLISHED_ACTION,
        },
      ];
      tables["sys_update_xml"] = [...(tables["sys_update_xml"] ?? []), ...rows];
      return [...records.flows, ...records.actions].map((sysId) => ({
        sysId,
        published: true,
        message: "Published successfully",
      }));
    },
  };
  return installer;
}

function memoryJournal() {
  let stored: PushJournal | null = null;
  return {
    read: async () => stored,
    write: async (journal: PushJournal) => {
      stored = journal;
    },
    clear: async () => {
      stored = null;
    },
    get current() {
      return stored;
    },
  };
}

function fluentSetup(options: { refuse?: boolean; endpoint?: boolean; flowDomain?: string } = {}) {
  const base = setup({ changed: [] });
  base.state.mirror[ENDPOINT] = record("sys_ws_operation", "20307c3bff277610a6c4ffffffffff7e", {
    name: "Activate flows and actions",
  });
  if (options.endpoint === false) delete base.state.mirror[ENDPOINT];
  base.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin", sys_domain: "global" }];
  base.tables["sys_hub_flow"] =
    options.flowDomain === undefined
      ? []
      : [{ sys_id: FLOW, name: "Page on-call", sys_domain: options.flowDomain }];
  const calls: string[] = [];
  const journal = memoryJournal();
  const deps: PushDependencies = {
    ...base.deps,
    fluent: { changedSince: async () => [PACKAGE] },
    reader: base.fake.reader,
    writer: memoryWriter(base.tables, calls),
    journal,
    catalog: { parents: {}, scopes: {}, typedFields: {} },
    username: "admin",
    url: "https://dev.example.com",
    pullRequests: {
      find: async () => ({ kind: "none" }),
      defaultBranch: async () => "main",
      openDraft: async () => "",
    },
    elevatedSessions: null,
    fluentInstaller: fakeInstaller(base.tables, calls, options.refuse),
  };
  return { ...base, deps, calls, journal };
}

const QUERY = { instance: "dev", allowCollisions: false, confirm: true };

describe("push, Fluent projects (ADR-0028 as amended)", () => {
  it("plans each flow and action as one change, ready with no record change", async () => {
    const { deps } = fluentSetup();
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.ready).toBe(true);
    expect(plan.fluent).toEqual([
      {
        project: "source/global",
        scope: "global",
        table: "sys_hub_flow",
        sysId: FLOW,
        name: "Page on-call",
        kind: "flow",
      },
      {
        project: "source/global",
        scope: "global",
        table: "sys_hub_action_type_definition",
        sysId: ACTION,
        name: "Score",
        kind: "action",
      },
    ]);
  });

  it("binds the plan to the build: another digest gives another plan id", async () => {
    const { deps } = fluentSetup();
    const first = (await computePlan(deps, QUERY)).plan.planId;
    const other = { ...deps, fluent: { changedSince: async () => [{ ...PACKAGE, digest: "d2" }] } };
    expect((await computePlan(other, QUERY)).plan.planId).not.toBe(first);
  });

  it("is not ready when the instance has no publishing endpoint", async () => {
    const { deps } = fluentSetup({ endpoint: false });
    const { plan } = await computePlan(deps, QUERY);
    expect(plan.ready).toBe(false);
    expect(plan.problems).toEqual([
      expect.objectContaining({
        path: "source/global",
        reason: expect.stringContaining("activate_flows"),
      }),
    ]);
  });

  it("is not ready for a project of type package: push delivers configuration projects", async () => {
    const { deps } = fluentSetup();
    const app = {
      ...deps,
      fluent: { changedSince: async () => [{ ...PACKAGE, configuration: false }] },
    };
    const { plan } = await computePlan(app, QUERY);
    expect(plan.ready).toBe(false);
    expect(plan.problems).toEqual([
      expect.objectContaining({
        path: "source/global/now.config.json",
        reason: expect.stringContaining('"type": "configuration"'),
      }),
    ]);
  });

  it("loads into the batch while it is the user's update set, publishes, and finds the published versions captured", async () => {
    const { deps, calls } = fluentSetup();
    const planId = (await computePlan(deps, QUERY)).plan.planId;
    const result = await push(deps, { ...QUERY, planId });
    expect(result.fluent).toEqual([
      expect.objectContaining({ sysId: FLOW, kind: "flow", captured: true }),
      expect.objectContaining({ sysId: ACTION, kind: "action", captured: true }),
    ]);
    expect(result.notCaptured).toBe(0);
    expect(result.flowsInactiveMs).toBeGreaterThanOrEqual(0);
    const load = calls.findIndex((c) => c.startsWith("fluent load"));
    const publish = calls.findIndex((c) => c.startsWith("fluent publish"));
    expect(calls[load]).toBe("fluent load global 2 files into s2");
    expect(calls[publish]).toBe(`fluent publish global flows=${FLOW} actions=${ACTION}`);
    // The batch is the user's update set from before the load until after the publish, and
    // the preference is restored last.
    const selected = calls.indexOf("insert sys_user_preference name,user,value");
    expect(selected).toBeLessThan(load);
    expect(calls.slice(publish + 1).some((c) => c.startsWith("update sys_user_preference"))).toBe(
      true,
    );
  });

  it("reports a flow whose published version the update set does not hold as not captured", async () => {
    const { deps, tables } = fluentSetup();
    const planId = (await computePlan(deps, QUERY)).plan.planId;
    const installer = deps.fluentInstaller;
    if (installer === null) throw new Error("no installer");
    const drafts: FluentInstaller = {
      ...installer,
      publish: async (scope, records, signal) => {
        const results = await installer.publish(scope, records, signal);
        tables["sys_update_xml"] = (tables["sys_update_xml"] ?? []).map((row) =>
          row["name"] === `sys_hub_flow_${FLOW}`
            ? { ...row, payload: "<status>draft</status>" }
            : row,
        );
        return results;
      },
    };
    const result = await push({ ...deps, fluentInstaller: drafts }, { ...QUERY, planId });
    expect(result.fluent.find((r) => r.sysId === FLOW)?.captured).toBe(false);
    expect(result.notCaptured).toBe(1);
  });

  it("stops with the flows the instance refused to publish, and restores the user's preferences", async () => {
    const { deps, tables } = fluentSetup({ refuse: true });
    const planId = (await computePlan(deps, QUERY)).plan.planId;
    const error = await push(deps, { ...QUERY, planId }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FlowPublishFailedError);
    expect(String(error)).toContain("Page on-call (No Trigger instance found)");
    const preferences = tables["sys_user_preference"] ?? [];
    expect(preferences.find((p) => p["name"] === "sys_update_set")?.["value"] ?? "").toBe("");
  });

  it("refuses before any write when an existing flow is in another domain than the user", async () => {
    const { deps, calls } = fluentSetup({ flowDomain: "09ff3d105f231000b12e3572f2b4775d" });
    const planId = (await computePlan(deps, QUERY)).plan.planId;
    await expect(push(deps, { ...QUERY, planId })).rejects.toThrow(FlowDomainMismatchError);
    expect(calls).toEqual([]);
  });

  it("journals the load before and after it", async () => {
    const { deps, journal } = fluentSetup({ refuse: true });
    const planId = (await computePlan(deps, QUERY)).plan.planId;
    await push(deps, { ...QUERY, planId }).catch(() => {});
    expect(journal.current?.steps).toEqual([
      { operation: "fluent-load", table: "sys_hub_flow", sysId: "source/global", state: "written" },
    ]);
  });
});
