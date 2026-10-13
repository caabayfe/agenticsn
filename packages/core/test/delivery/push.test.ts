import { describe, expect, it } from "bun:test";
import {
  computePlan,
  type PullRequestLookup,
  type PushDependencies,
  type PushJournal,
  push,
} from "@snagentic/core";
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

const PR = "https://github.com/acme/now/pull/7";

// The git platform as the PullRequests port sees it (ADR-0022).
function fakePullRequests(calls: string[]) {
  const platform = {
    lookup: { kind: "none" } as PullRequestLookup,
    defaultBranch: "main",
    lookups: 0,
    opened: [] as { branch: string; title: string; body: string; instanceWrites: number }[],
  };
  const port = {
    find: async () => {
      platform.lookups += 1;
      return platform.lookup;
    },
    defaultBranch: async () => platform.defaultBranch,
    openDraft: async (request: { branch: string; title: string; body: string }) => {
      platform.opened.push({ ...request, instanceWrites: calls.length });
      return PR;
    },
  };
  return { platform, port };
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
  const pullRequests = fakePullRequests(calls);
  const deps: PushDependencies = {
    ...base.deps,
    reader: base.fake.reader,
    writer,
    journal: journal.store,
    catalog: { parents: {}, scopes: {}, typedFields: {} },
    username: "admin",
    url: "https://dev.example.com",
    pullRequests: pullRequests.port,
    elevatedSessions: null,
  };
  return { ...base, deps, calls, journal, platform: pullRequests.platform };
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
          name: "snagentic: feature/p1",
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
      "insert sys_user_preference name,user,value",
      "update sys_script order=200",
      "update sys_user_preference value=",
      "update sys_user_preference value=",
    ]);
    expect(tables["sys_script"]?.[0]?.["order"]).toBe("200");
    expect(journal.current).toBeNull();
    expect(journal.history.some((j) => j.preferences.length === 2 && j.steps.length === 0)).toBe(
      true,
    );
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

  it("puts another scope's changes in a child of the branch's batch", async () => {
    const SCOPED_ID = "abcdefabcdefabcdefabcdefabcdefab";
    const path = `x_acme/sys_script/scoped--${SCOPED_ID}`;
    const fields = { name: "Scoped", order: "1" };
    const scoped = record("sys_script", SCOPED_ID, fields, undefined, "x_acme");
    const edited = record("sys_script", SCOPED_ID, { ...fields, order: "2" }, undefined, "x_acme");
    const base = pushSetup({
      mirror: { [path]: scoped },
      working: { [path]: edited },
      changed: [`${path}.yaml`],
    });
    const { tables } = base;
    const deps = {
      ...base.deps,
      catalog: { parents: {}, scopes: { a1: "x_acme" }, typedFields: {} },
    };
    tables["sys_script"] = [
      { sys_id: SCOPED_ID, sys_class_name: "sys_script", sys_scope: "a1", ...fields },
    ];
    tables["sys_update_set"] = [];
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(tables["sys_update_set"]).toMatchObject([
      { name: "snagentic: feature/p1", application: "global", state: "in progress" },
      { name: "snagentic: feature/p1 [x_acme]", application: "a1", parent: "new1" },
    ]);
    expect(result).toMatchObject({
      batch: { name: "snagentic: feature/p1", sysId: "new1", created: true },
      updateSets: [{ scope: "x_acme", name: "snagentic: feature/p1 [x_acme]", created: true }],
      written: [{ path: `${path}.yaml`, captured: true }],
    });
    const again = await push(deps, { ...QUERY, planId: await planned(deps) }).catch((e) => e);
    expect(again).toMatchObject({ code: "record-changed-on-instance" });
    expect(tables["sys_update_set"]).toHaveLength(2);
  });

  it("links the pull request from the batch's description", async () => {
    const { deps, tables } = pushSetup();
    const pr = "https://github.com/acme/now/pull/42";
    await push(deps, { ...QUERY, planId: await planned(deps), pr });
    const batch = (tables["sys_update_set"] ?? []).find((row) => row["sys_id"] === "s2");
    expect(batch?.["description"]).toContain(`Pull request: ${pr}`);
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
    expect(journal.current).toMatchObject({ preferences: [] });
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
      preferences: [{ sysId: "pref1", user: "u1", name: "sys_update_set", previousValue: "mine" }],
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

describe("push and the branch's pull request (ADR-0022)", () => {
  const batchOf = (tables: Record<string, Record<string, string>[]>) =>
    (tables["sys_update_set"] ?? []).find((row) => row["sys_id"] === "s2");

  it("links the branch's open pull request from the batch", async () => {
    const { deps, tables, platform } = pushSetup();
    platform.lookup = { kind: "found", url: PR };
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(result.pullRequest).toEqual({ status: "found", url: PR });
    expect(batchOf(tables)?.["description"]).toContain(`Pull request: ${PR}`);
  });

  it("uses the pull request it is given without asking the platform", async () => {
    const { deps, platform } = pushSetup();
    const given = "https://github.com/acme/now/pull/9";
    const result = await push(deps, { ...QUERY, planId: await planned(deps), pr: given });
    expect(result.pullRequest).toEqual({ status: "given", url: given });
    expect(platform.lookups).toBe(0);
  });

  it("still pushes when the platform cannot be asked, and says why nothing is linked", async () => {
    const { deps, platform } = pushSetup();
    platform.lookup = { kind: "unavailable", reason: "gh is not installed" };
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(result.pullRequest).toEqual({ status: "unavailable", reason: "gh is not installed" });
    expect(result.written).toHaveLength(1);
  });

  it("reports a branch without a pull request, and how to open one", async () => {
    const { deps } = pushSetup();
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(result.pullRequest).toEqual({ status: "none" });
  });

  it("opens a draft pull request naming the batch before writing to the instance", async () => {
    const { deps, tables, platform, state, calls } = pushSetup();
    const result = await push(deps, { ...QUERY, planId: await planned(deps), draftPr: true });
    expect(state.published).toEqual(["feature/p1"]);
    expect(platform.opened).toEqual([
      {
        branch: "feature/p1",
        title: "feature/p1",
        body: expect.stringContaining("`snagentic: feature/p1`"),
        instanceWrites: 0,
      },
    ]);
    expect(platform.opened[0]?.body).toContain(
      "https://dev.example.com/sys_update_set_list.do?sysparm_query=name%3Dsnagentic%3A%20feature%2Fp1",
    );
    expect(result.pullRequest).toEqual({ status: "created", url: PR });
    expect(batchOf(tables)?.["description"]).toContain(`Pull request: ${PR}`);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("does not open another when the branch already has one", async () => {
    const { deps, platform, state } = pushSetup();
    platform.lookup = { kind: "found", url: PR };
    const result = await push(deps, { ...QUERY, planId: await planned(deps), draftPr: true });
    expect(result.pullRequest).toEqual({ status: "found", url: PR });
    expect(platform.opened).toEqual([]);
    expect(state.published).toEqual([]);
  });

  it("refuses a draft pull request while a planned record has uncommitted changes", async () => {
    const { deps, calls, state } = pushSetup({ uncommitted: [`${RULE}.script.js`, "other.yaml"] });
    await expect(
      push(deps, { ...QUERY, planId: await planned(deps), draftPr: true }),
    ).rejects.toMatchObject({ code: "uncommitted-planned-changes" });
    expect(calls).toEqual([]);
    expect(state.published).toEqual([]);
  });

  it("refuses a draft pull request from the default branch, or without the platform", async () => {
    const onMain = pushSetup();
    onMain.platform.defaultBranch = "feature/p1";
    await expect(
      push(onMain.deps, { ...QUERY, planId: await planned(onMain.deps), draftPr: true }),
    ).rejects.toMatchObject({ code: "pull-request-from-default-branch" });
    const offline = pushSetup();
    offline.platform.lookup = { kind: "unavailable", reason: "gh is not signed in" };
    await expect(
      push(offline.deps, { ...QUERY, planId: await planned(offline.deps), draftPr: true }),
    ).rejects.toMatchObject({ code: "pull-request-unavailable" });
    expect([...onMain.calls, ...offline.calls]).toEqual([]);
  });
});

describe("push: child rows (ADR-0025)", () => {
  const SECTION_ID = "fedcba9876543210fedcba9876543210";
  const SECTION = `global/sys_ui_section/u-review--${SECTION_ID}`;
  const FIELDS = `${SECTION}.children.sys_ui_element.yaml`;
  const ROW = "1".repeat(32);
  const pulledRow = {
    sys_id: ROW,
    sys_ui_section: SECTION_ID,
    element: "number",
    position: "0",
    sys_mod_count: "0",
    sys_updated_on: "2026-10-13 10:00:00",
  };
  const section = record("sys_ui_section", SECTION_ID, { name: "u_review", view: "Default" });

  // The platform records a section's fields as the section, under its sys_update_name.
  function sectionSetup(overrides: Partial<State>, onInstance: Record<string, string>[] = []) {
    const run = pushSetup(overrides);
    run.tables["sys_ui_section"] = [
      { sys_id: SECTION_ID, sys_update_name: `sys_ui_section_${SECTION_ID}` },
    ];
    run.tables["sys_ui_element"] = onInstance;
    const writer = memoryWriter(run.tables, run.calls, {
      on: true,
      name: (table, row) =>
        table === "sys_ui_element"
          ? `sys_ui_section_${row["sys_ui_section"] ?? ""}`
          : (row["sys_update_name"] ?? `${table}_${row["sys_id"] ?? ""}`),
    });
    return { ...run, deps: { ...run.deps, writer } };
  }

  it("creates a row with its content fields and finds it captured as its owner", async () => {
    const row = { sys_id: ROW, sys_ui_section: SECTION_ID, element: "decision", position: "1" };
    const { deps, calls } = sectionSetup({
      mirror: { ...setup().state.mirror, [SECTION]: section },
      working: { ...setup().state.working, [SECTION]: section },
      changed: [FIELDS],
      documents: { mirror: {}, working: { [FIELDS]: [row] } },
    });
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(calls).toContain("insert sys_ui_element element,position,sys_id,sys_ui_section");
    expect(result.written).toEqual([
      expect.objectContaining({ table: "sys_ui_element", sysId: ROW, captured: true }),
    ]);
    expect(result.notCaptured).toBe(0);
  });

  it("updates a changed row, and stops when the instance changed it since the pull", async () => {
    const overrides = {
      mirror: { ...setup().state.mirror, [SECTION]: section },
      working: { ...setup().state.working, [SECTION]: section },
      changed: [FIELDS],
      documents: {
        mirror: { [FIELDS]: [pulledRow] },
        working: { [FIELDS]: [{ ...pulledRow, position: "4" }] },
      },
    };
    const fresh = sectionSetup(overrides, [{ ...pulledRow }]);
    await push(fresh.deps, { ...QUERY, planId: await planned(fresh.deps) });
    expect(fresh.calls).toContain("update sys_ui_element position=4");
    const moved = sectionSetup(overrides, [{ ...pulledRow, sys_mod_count: "1" }]);
    await expect(
      push(moved.deps, { ...QUERY, planId: await planned(moved.deps) }),
    ).rejects.toMatchObject({ code: "record-changed-on-instance" });
  });

  it("finds a record captured under the name the platform gave it", async () => {
    const run = pushSetup();
    run.tables["sys_script"] = (run.tables["sys_script"] ?? []).map((row) => ({
      ...row,
      sys_update_name: "sys_script_named_by_the_platform",
    }));
    const result = await push(run.deps, { ...QUERY, planId: await planned(run.deps) });
    expect(result.notCaptured).toBe(0);
    expect(run.tables["sys_update_xml"]?.map((row) => row["name"])).toEqual([
      "sys_script_named_by_the_platform",
    ]);
  });
});

describe("push: a new application (ADR-0025)", () => {
  const APP_ID = "abcdefabcdefabcdefabcdefabcdef12";
  const SCOPE = "x_acme_access_rev";
  const APP = `${SCOPE}/sys_app/access-review--${APP_ID}`;
  const INCLUDE = `${SCOPE}/sys_script_include/generator--${"9".repeat(32)}`;

  it("creates the application first, in its scope's update set opened with its sys_id", async () => {
    const application = record(
      "sys_app",
      APP_ID,
      { name: "Access Review", scope: SCOPE, version: "1.0.0" },
      undefined,
      SCOPE,
    );
    const include = record(
      "sys_script_include",
      "9".repeat(32),
      { name: "Gen" },
      "var Gen;",
      SCOPE,
    );
    const { deps, calls, tables } = pushSetup({
      working: { ...setup().state.working, [APP]: application, [INCLUDE]: include },
      changed: [`${RULE}.yaml`, `${INCLUDE}.yaml`, `${APP}.yaml`],
    });
    const result = await push(deps, { ...QUERY, planId: await planned(deps) });
    const child = tables["sys_update_set"]?.find((set) => set["name"]?.endsWith(`[${SCOPE}]`));
    expect(child?.["application"]).toBe(APP_ID);
    const scoped = calls.filter(
      (call) => call.includes("sys_app ") || call.includes("sys_script_include"),
    );
    expect(scoped).toEqual([
      "insert sys_app name,scope,sys_id,sys_scope,version",
      "insert sys_script_include name,script,sys_id,sys_scope",
    ]);
    expect(calls).toContain("insert sys_user_preference name,user,value");
    expect(
      tables["sys_user_preference"]?.some((p) => p["name"] === `updateSetForScope${APP_ID}`),
    ).toBe(true);
    expect(result.notCaptured).toBe(0);
    // The platform creates records in the current application, whatever sys_scope says.
    expect(tables["sys_script_include"]?.[0]?.["sys_scope"]).toBe(APP_ID);
    const current = tables["sys_user_preference"]?.find((p) => p["name"] === "apps.current_app");
    expect(current?.["value"]).toBe("");
  });
});

describe("push: the user's preferences", () => {
  it("makes each scope's application current while writing it, then restores it", async () => {
    const { deps, tables } = pushSetup();
    tables["sys_user_preference"] = [
      { sys_id: "app1", user: "u1", name: "apps.current_app", value: "some_other_app" },
    ];
    await push(deps, { ...QUERY, planId: await planned(deps) });
    expect(tables["sys_update_xml"]?.[0]?.["update_set"]).toBe("s2");
    expect(tables["sys_user_preference"]?.find((p) => p["sys_id"] === "app1")?.["value"]).toBe(
      "some_other_app",
    );
  });

  it("restores a preference the instance replaced while the push ran, by user and name", async () => {
    const { deps, tables, journal } = pushSetup();
    const writer = deps.writer;
    const replacing = {
      ...writer,
      update: async (
        table: string,
        sysId: string,
        values: Readonly<Record<string, string>>,
        signal: AbortSignal,
      ) => {
        if (table === "sys_script") {
          // The platform swaps the preference row for another one.
          tables["sys_user_preference"] = (tables["sys_user_preference"] ?? []).map((p) =>
            p["name"] === "sys_update_set" ? { ...p, sys_id: "replaced" } : p,
          );
        }
        return writer.update(table, sysId, values, signal);
      },
    };
    await push({ ...deps, writer: replacing }, { ...QUERY, planId: await planned(deps) });
    expect(tables["sys_user_preference"]?.find((p) => p["sys_id"] === "replaced")?.["value"]).toBe(
      "",
    );
    expect(journal.current).toBeNull();
  });

  it("reports the write that failed, even when restoring a preference fails too", async () => {
    const { deps, journal } = pushSetup();
    const writer = deps.writer;
    const failing = {
      ...writer,
      update: async (
        table: string,
        sysId: string,
        values: Readonly<Record<string, string>>,
        signal: AbortSignal,
      ) => {
        if (table === "sys_script") {
          throw new Error("the write failed");
        }
        if (table === "sys_user_preference" && values["value"] === "") {
          throw new Error("restoring failed");
        }
        return writer.update(table, sysId, values, signal);
      },
    };
    await expect(
      push({ ...deps, writer: failing }, { ...QUERY, planId: await planned(deps) }),
    ).rejects.toThrow("the write failed");
    // What was not restored stays in the journal, for the next push to restore.
    expect(journal.current?.preferences.length).toBeGreaterThan(0);
  });
});
