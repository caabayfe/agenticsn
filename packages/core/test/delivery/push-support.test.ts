import { describe, expect, it } from "bun:test";
import {
  computeUnitPlan,
  IntegrationUserNotFoundError,
  PlanNotReadyError,
  PullRequestFromDefaultBranchError,
  PullRequestUnavailableError,
  pullRequestFor,
  pushUnits,
  UncommittedPlannedChangesError,
  UpdateSetScopeError,
} from "@snagentic/core";
import { QUERY, SI_UNIT, unitSetup } from "./unit-fixture";

// What push needs around the loads: the branch's pull request, its update sets, collisions with
// other update sets, and the flows the instance would refuse to publish.

const lookup = (kind: "found" | "none" | "unavailable") => ({
  find: async () =>
    kind === "found"
      ? { kind, url: "https://github.com/a/b/pull/7" }
      : kind === "none"
        ? { kind }
        : { kind, reason: "gh is not signed in" },
  defaultBranch: async () => "main",
  openDraft: async (request: { body: string }) =>
    `https://github.com/a/b/pull/8#${request.body.length}`,
});

describe("the branch's pull request (ADR-0022)", () => {
  it("takes one given, finds the branch's own, or says why there is none", async () => {
    const { deps } = unitSetup();
    const request = { label: "feature/p1" };
    expect(await pullRequestFor(deps, { ...request, pr: "https://g/pull/1" })).toEqual({
      status: "given",
      url: "https://g/pull/1",
    });
    expect(await pullRequestFor({ ...deps, pullRequests: lookup("found") }, request)).toEqual({
      status: "found",
      url: "https://github.com/a/b/pull/7",
    });
    expect(await pullRequestFor({ ...deps, pullRequests: lookup("none") }, request)).toEqual({
      status: "none",
    });
    expect(await pullRequestFor({ ...deps, pullRequests: lookup("unavailable") }, request)).toEqual(
      {
        status: "unavailable",
        reason: "gh is not signed in",
      },
    );
  });

  it("opens a draft from the published branch, never from the default branch or with uncommitted source", async () => {
    const { deps, state } = unitSetup();
    const draft = { label: "feature/p1", draftPr: true };
    const created = await pullRequestFor({ ...deps, pullRequests: lookup("none") }, draft);
    expect(created).toMatchObject({ status: "created" });
    expect(state.published).toEqual(["feature/p1"]);
    await expect(
      pullRequestFor({ ...deps, pullRequests: lookup("unavailable") }, draft),
    ).rejects.toBeInstanceOf(PullRequestUnavailableError);
    const onDefault = { ...lookup("none"), defaultBranch: async () => "feature/p1" };
    await expect(
      pullRequestFor({ ...deps, pullRequests: onDefault }, draft),
    ).rejects.toBeInstanceOf(PullRequestFromDefaultBranchError);
    state.uncommittedSource = ["source/x_app/a.now.ts"];
    await expect(
      pullRequestFor({ ...deps, pullRequests: lookup("none") }, draft),
    ).rejects.toBeInstanceOf(UncommittedPlannedChangesError);
  });
});

describe("push's update sets and checks", () => {
  it("reuses the branch's open batch and child, adding the pull request's link once", async () => {
    const context = unitSetup({ source: "Edited in source." });
    const first = await computeUnitPlan(context.deps, QUERY);
    const pushed = await pushUnits(context.deps, {
      ...QUERY,
      planId: first.plan.planId,
      confirm: true,
      pr: "https://g/pull/3",
    });
    expect(pushed.batch).toMatchObject({ sysId: "s2", created: false });
    expect(
      context.tables["sys_update_set"]?.find((s) => s["sys_id"] === "s2")?.["description"],
    ).toContain("https://g/pull/3");
    const child = pushed.updateSets[0];
    const unit = context.builds.get(context.project.path)?.[0];
    if (unit === undefined) throw new Error("no unit");
    context.builds.set(context.project.path, [
      { ...unit, head: { ...unit.head, fields: { ...unit.head.fields, description: "Again." } } },
    ]);
    const second = await computeUnitPlan(context.deps, QUERY);
    const again = await pushUnits(context.deps, {
      ...QUERY,
      planId: second.plan.planId,
      confirm: true,
      pr: "https://g/pull/3",
    });
    expect(again.updateSets[0]).toMatchObject({ sysId: child?.sysId, created: false });
  });

  it("refuses when the instance creates the scope's update set in another application", async () => {
    const context = unitSetup({ source: "Edited in source." });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    // The preference that makes the application current does not take, so the instance creates
    // the update set in the current application, global.
    const insert = context.deps.writer.insert;
    const ignored = (table: string, values: Readonly<Record<string, string>>) =>
      table === "sys_user_preference" && values["name"] === "apps.current_app"
        ? { ...values, name: "ignored" }
        : values;
    const misplaced = {
      ...context.deps,
      writer: {
        ...context.deps.writer,
        insert: async (
          table: string,
          values: Readonly<Record<string, string>>,
          signal: AbortSignal,
        ) => insert(table, ignored(table, values), signal),
      },
    };
    await expect(
      pushUnits(misplaced, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toBeInstanceOf(UpdateSetScopeError);
  });

  it("refuses when the signed-in user is not found", async () => {
    const context = unitSetup({ source: "Edited in source." });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    context.tables["sys_user"] = [];
    await expect(
      pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toBeInstanceOf(IntegrationUserNotFoundError);
  });

  it("moves its own load out of the application's Default update set, and reports one it cannot find", async () => {
    const context = unitSetup({ source: "Edited in source." });
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    const load = context.deps.installer.load;
    context.tables["sys_update_set"]?.push({
      sys_id: "d1",
      name: "Default",
      state: "in progress",
      application: "x",
    });
    const intoDefault = {
      ...context.deps,
      installer: {
        ...context.deps.installer,
        load: async (
          scopeId: string,
          files: readonly { name: string; content: string }[],
          _set: string,
          signal: AbortSignal,
        ) => load(scopeId, files, "d1", signal),
      },
    };
    const result = await pushUnits(intoDefault, { ...QUERY, planId: plan.planId, confirm: true });
    expect(result.units[0]?.captured).toBe(true);
    expect(
      context.tables["sys_update_xml"]?.find((u) => u["name"] === SI_UNIT)?.["update_set"],
    ).not.toBe("d1");

    const lost = unitSetup({ source: "Edited in source." });
    const lostPlan = await computeUnitPlan(lost.deps, QUERY);
    const nowhere = {
      ...lost.deps,
      installer: { ...lost.deps.installer, load: async () => {} },
    };
    const pushed = await pushUnits(nowhere, {
      ...QUERY,
      planId: lostPlan.plan.planId,
      confirm: true,
    });
    expect(pushed).toMatchObject({ notCaptured: 1, notApplied: 1, ledgerCommit: null });
  });

  it("reports units held in someone else's open update set, and is not ready unless allowed", async () => {
    const context = unitSetup({ source: "Edited in source." });
    context.tables["sys_update_xml"] = [
      { sys_id: "x1", name: SI_UNIT, update_set: "s1", sys_updated_by: "pat" },
    ];
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.collisions).toEqual([
      {
        path: "source/x_app",
        record: SI_UNIT,
        heldBy: [{ updateSet: "s1", updateSetName: "Someone's work", updatedBy: "pat" }],
      },
    ]);
    expect(plan.ready).toBe(false);
    await expect(
      pushUnits(context.deps, { ...QUERY, planId: plan.planId, confirm: true }),
    ).rejects.toBeInstanceOf(PlanNotReadyError);
    expect(
      (await computeUnitPlan(context.deps, { ...QUERY, allowCollisions: true })).plan.ready,
    ).toBe(true);
  });

  it("never loads a flow in a domain the signed-in user is not in: the instance would not publish it", async () => {
    const context = unitSetup();
    const FLOW = "f".repeat(32);
    const flow = (name: string) => ({
      updateName: `sys_hub_flow_${FLOW}`,
      file: `sys_hub_flow_${FLOW}.xml`,
      head: {
        table: "sys_hub_flow",
        sysId: FLOW,
        action: "INSERT_OR_UPDATE" as const,
        fields: { sys_id: FLOW, name },
        referenceNames: {},
      },
      children: [],
    });
    context.tables["sys_hub_flow"] = [
      {
        sys_id: FLOW,
        name: "Notify",
        sys_domain: "d1",
        sys_mod_count: "1",
        sys_updated_on: "2026-10-16 06:30:48",
      },
    ];
    context.tables["sys_user"] = [{ sys_id: "u1", user_name: "admin", sys_domain: "global" }];
    const ledger = context.authoring.ledgers.get(context.project.path);
    context.authoring.ledgers.set(
      context.project.path,
      new Map([
        [
          "dev",
          new Map([
            ...(ledger?.get("dev") ?? []),
            [
              `sys_hub_flow_${FLOW}`,
              { build: "older", instance: "1|2026-10-16 06:30:48", losses: [] },
            ],
          ]),
        ],
      ]),
    );
    context.builds.set(context.project.path, [
      ...(context.builds.get(context.project.path) ?? []),
      flow("Notify v2"),
    ]);
    const { plan } = await computeUnitPlan(context.deps, QUERY);
    expect(plan.problems).toMatchObject([{ updateName: `sys_hub_flow_${FLOW}`, kind: "unsafe" }]);
    expect(plan.units).toEqual([]);
  });
});
