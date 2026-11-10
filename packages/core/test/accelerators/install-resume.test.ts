import { describe, expect, it } from "bun:test";
import {
  type ActivationProgress,
  ActivationStateUnknownError,
  type InstallPlan,
  type InstallRecord,
  type InstallSteps,
  installApproval,
  installPack,
  planInstall,
  StoreAppInstallStateUnknownError,
} from "@snagentic/core";
import { fakeSteps, memoryJournal } from "../support/install-fakes";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// An install whose component outcome was lost is resumed by reading that outcome, never by asking
// again (spec 011, section 5, I3 criterion c).
const PACK: PackFixture = {
  pack: { id: "zt", version: "0.1.0", requires: { snagentic: ">=2.1.0" } },
  modules: {
    dex: {
      label: "ZT: dex",
      components: [
        { kind: "plugin", id: "com.snc.pa" },
        { kind: "app", id: "sn_dex" },
      ],
    },
  },
  files: { "modules/dex/source/global/src/fluent/dex.now.ts": "// dex" },
};

const QUERY = {
  pack: "zt",
  instance: { root: "/w", name: "everis2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.17.0",
  signal: new AbortController().signal,
};

const progress = (status: ActivationProgress["status"], error = ""): ActivationProgress => ({
  progressId: "prog9",
  status,
  percent: status === "running" ? 40 : 100,
  message: "",
  error,
});

function deps(steps: InstallSteps, journal = memoryJournal().journal) {
  const clock = { ms: 0 };
  return {
    packs: memoryPacks({ zt: packFiles(PACK) }),
    inventory: {
      read: async (_root: string, _instance: string, file: string) =>
        file === "plugins" ? [{ id: "com.snc.pa", active: "inactive", version: "1.0.0" }] : [],
    },
    workspace: {
      mirrorCommit: async () => "m1",
      installReports: async () => [],
      includes: async () => true,
      present: async () => [],
      parse: (text: string) => JSON.parse(text),
      previous: async () => ({ written: [], kept: [] }),
      commit: async () => "c",
      merge: async () => ({ branch: "b", conflicts: [] }),
    },
    updateSets: { open: async () => [] },
    catalog: { available: async () => [{ scope: "sn_dex", version: "5.3.2", blocked: false }] },
    templates: {
      tracked: async () => false,
      read: async () => null,
      parse: () => ({ columns: [], rows: [] }),
    },
    schema: { ready: async () => true, fieldsOf: async () => [], refresh: () => {} },
    steps,
    journal,
    now: () => {
      clock.ms += 1000;
      return new Date(clock.ms);
    },
  };
}

// A journal where the install of sn_dex stopped with its outcome unknown.
const lostInstall = (plan: InstallPlan): InstallRecord => ({
  planId: plan.planId,
  approved: installApproval(plan),
  startedAt: "2026-11-03T10:00:00.000Z",
  steps: [
    { step: "activate com.snc.pa", outcome: "done", detail: "active after 3 s", seconds: 3 },
    {
      step: "install sn_dex 5.3.2",
      outcome: "stopped",
      detail: "the state of sn_dex's install is unknown: socket hang up",
      seconds: 60,
      progressId: "prog9",
    },
  ],
});

describe("resuming an install whose component outcome was lost (spec 011, I3 c)", () => {
  it("keeps the progress id of an install whose outcome is unknown in the journal", async () => {
    const { steps } = fakeSteps({
      installFails: new StoreAppInstallStateUnknownError(
        "sn_dex",
        "still running after 45 min",
        "prog9",
      ),
    });
    const { journal, state } = memoryJournal();
    const plan = await planInstall(deps(steps), QUERY);
    const result = await installPack(deps(steps, journal), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toMatchObject({ step: "install sn_dex 5.3.2", progressId: "prog9" });
    expect(state.record?.steps.at(-1)).toMatchObject({ progressId: "prog9" });
  });

  it("keeps the progress id of a plugin activation whose outcome is unknown", async () => {
    const { steps } = fakeSteps({
      activateFails: new ActivationStateUnknownError("com.snc.pa", "socket hang up", "prog7"),
    });
    const { journal, state } = memoryJournal();
    const plan = await planInstall(deps(steps), QUERY);
    await installPack(deps(steps, journal), { ...QUERY, confirm: plan.planId });
    expect(state.record?.steps.at(-1)).toMatchObject({
      step: "activate com.snc.pa",
      progressId: "prog7",
    });
  });

  it("reads the lost outcome first, and goes on without asking again when it succeeded", async () => {
    const { steps, calls } = fakeSteps({ progress: [progress("successful")] });
    const plan = await planInstall(deps(steps), QUERY);
    const { journal } = memoryJournal(lostInstall(plan));
    const result = await installPack(deps(steps, journal), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    expect(calls.slice(0, 2)).toEqual(["progress prog9", "refresh"]);
    expect(calls.some((c) => c.startsWith("install ") || c.startsWith("activate "))).toBe(false);
    expect(result.steps.filter((s) => s.step === "install sn_dex 5.3.2").at(-1)).toMatchObject({
      step: "install sn_dex 5.3.2",
      outcome: "done",
      detail: "finished on the instance after the run lost it (progress prog9)",
    });
  });

  it("stops again, asking nothing, while the lost install is still running", async () => {
    const { steps, calls } = fakeSteps({ progress: [progress("running")] });
    const plan = await planInstall(deps(steps), QUERY);
    const { journal, state } = memoryJournal(lostInstall(plan));
    const result = await installPack(deps(steps, journal), { ...QUERY, confirm: plan.planId });
    // Only the report is committed: nothing is asked of the instance again.
    expect(calls).toEqual(["progress prog9", "commit 2"]);
    expect(result.stopped).toMatchObject({
      step: "install sn_dex 5.3.2",
      progressId: "prog9",
      detail: expect.stringContaining("still running (40%)"),
    });
    expect(state.record?.steps.at(-1)?.progressId).toBe("prog9");
  });

  it("stops with the failure the instance states, and lets the next run ask again", async () => {
    const { steps, calls } = fakeSteps({ progress: [progress("failed", "Unable to download")] });
    const plan = await planInstall(deps(steps), QUERY);
    const { journal, state } = memoryJournal(lostInstall(plan));
    const result = await installPack(deps(steps, journal), { ...QUERY, confirm: plan.planId });
    // Only the report is committed: nothing is asked of the instance again.
    expect(calls).toEqual(["progress prog9", "commit 2"]);
    expect(result.stopped?.detail).toContain("Unable to download");
    // A definite failure keeps no progress id: the next run requests the install again.
    expect(state.record?.steps.at(-1)?.progressId).toBeUndefined();
  });
});
