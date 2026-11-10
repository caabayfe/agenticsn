import { describe, expect, it } from "bun:test";
import {
  InstallBlockedError,
  type InstallJournal,
  InstallResumeChangedError,
  InstallResumeUnknownError,
  type InstallSteps,
  installPack,
  planInstall,
} from "@snagentic/core";
import { fakeSteps, memoryJournal } from "../support/install-fakes";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// A resumed install runs the plan the admin approved (ADR-0038, item 2; spec 014, F7): the
// journal records what identifies that plan apart from the instance, and a resume refuses when
// the pack, its version, its modules or their content changed since.
const PACK: PackFixture = {
  pack: { id: "itsm", version: "0.1.0", requires: { snagentic: ">=2.1.0" } },
  modules: {
    foundation: {
      label: "ITSM: foundation",
      components: [{ kind: "plugin", id: "com.snc.cmdb.csdm" }],
    },
    incident: { label: "ITSM: incident", dependsOn: ["foundation"] },
  },
  files: {
    "modules/foundation/source/global/src/fluent/imports.now.ts": "// imports",
    "modules/incident/source/global/src/fluent/incident.now.ts": "// incident",
  },
};

const QUERY = {
  pack: "itsm",
  instance: { root: "/w", name: "pdi2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.2.0",
  signal: new AbortController().signal,
};

const READY = { "com.snc.cmdb.csdm": "active" } as const;

function deps(
  options: {
    pack?: PackFixture;
    plugins?: Record<string, "active" | "inactive">;
    steps?: InstallSteps;
    journal?: InstallJournal;
    mirror?: string;
  } = {},
) {
  return {
    packs: memoryPacks({ itsm: packFiles(options.pack ?? PACK) }),
    inventory: {
      read: async (_root: string, _instance: string, file: string) =>
        file === "plugins"
          ? Object.entries(options.plugins ?? READY).map(([id, active]) => ({
              id,
              active,
              version: "1.0.0",
            }))
          : [],
    },
    workspace: {
      mirrorCommit: async () => options.mirror ?? "m1",
      installReports: async () => [],
      includes: async () => true,
      present: async () => [],
      parse: (text: string) => JSON.parse(text),
      previous: async () => ({ written: [], kept: [] }),
      commit: async () => "c",
      merge: async () => ({ branch: "b", conflicts: [] }),
    },
    updateSets: { open: async () => [] },
    catalog: { available: async () => [] },
    templates: {
      tracked: async () => false,
      read: async () => null,
      parse: () => ({ columns: [], rows: [] }),
    },
    schema: { ready: async () => true, fieldsOf: async () => [], refresh: () => {} },
    steps: options.steps ?? fakeSteps().steps,
    journal: options.journal ?? memoryJournal().journal,
    now: () => new Date(0),
  };
}

// A confirmed run that stops at the incident module, leaving its journal to resume from.
async function stoppedRun() {
  const { journal, state } = memoryJournal();
  const plan = await planInstall(deps(), QUERY);
  const first = fakeSteps({ notApplied: { incident: 1 } });
  const result = await installPack(deps({ steps: first.steps, journal }), {
    ...QUERY,
    confirm: plan.planId,
  });
  expect(result.stopped?.step).toBe("module incident");
  return { plan, journal, state };
}

describe("resuming an install runs the approved plan (spec 014, F7)", () => {
  it("records the approved pack, its version, its modules and a hash of their content", async () => {
    const { plan, state } = await stoppedRun();
    expect(state.record?.approved).toEqual({
      pack: "itsm",
      version: "0.1.0",
      modules: ["foundation", "incident"],
      content: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(state.record?.planId).toBe(plan.planId);
  });

  it("refuses to resume once the pack's version changed, changing nothing", async () => {
    const { plan, journal } = await stoppedRun();
    const newer = { ...PACK, pack: { ...PACK.pack, version: "0.2.0" } };
    const { steps, calls } = fakeSteps();
    const resumed = installPack(deps({ pack: newer, steps, journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    await expect(resumed).rejects.toBeInstanceOf(InstallResumeChangedError);
    await expect(resumed).rejects.toMatchObject({
      code: "install-resume-changed",
      message: expect.stringContaining("version 0.1.0 is now 0.2.0"),
      hint: expect.stringContaining("run accelerator install again without --confirm"),
    });
    expect(calls).toEqual([]);
  });

  it("refuses to resume once a module's source changed under the same version", async () => {
    const { plan, journal } = await stoppedRun();
    const edited = {
      ...PACK,
      files: {
        ...PACK.files,
        "modules/incident/source/global/src/fluent/incident.now.ts": "// incident, edited",
      },
    };
    const { steps, calls } = fakeSteps();
    await expect(
      installPack(deps({ pack: edited, steps, journal }), { ...QUERY, confirm: plan.planId }),
    ).rejects.toMatchObject({
      code: "install-resume-changed",
      message: expect.stringContaining("content"),
    });
    expect(calls).toEqual([]);
  });

  it("refuses to resume when the modules it would install are not the approved ones", async () => {
    const { plan, journal } = await stoppedRun();
    const { steps, calls } = fakeSteps();
    await expect(
      installPack(deps({ steps, journal }), {
        ...QUERY,
        modules: ["foundation"],
        confirm: plan.planId,
      }),
    ).rejects.toMatchObject({
      code: "install-resume-changed",
      message: expect.stringContaining("modules foundation, incident are now foundation"),
    });
    expect(calls).toEqual([]);
  });

  it("refuses to resume while the plan it would run has blocking problems", async () => {
    const { plan, journal } = await stoppedRun();
    const { steps, calls } = fakeSteps();
    await expect(
      installPack(deps({ plugins: {}, steps, journal }), { ...QUERY, confirm: plan.planId }),
    ).rejects.toBeInstanceOf(InstallBlockedError);
    expect(calls).toEqual([]);
  });

  it("still resumes when only the instance moved on since the plan was approved", async () => {
    const { plan, journal } = await stoppedRun();
    const resumed = await installPack(deps({ mirror: "m2", journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    expect(resumed.plan.planId).not.toBe(plan.planId);
    expect(resumed.stopped).toBeNull();
  });

  it("refuses to resume a journal an older version wrote, which names no approved pack", async () => {
    const plan = await planInstall(deps(), QUERY);
    const { journal } = memoryJournal({
      planId: plan.planId,
      startedAt: "2026-11-01T10:00:00.000Z",
      steps: [{ step: "module foundation", outcome: "done", detail: "5 units", seconds: 2 }],
    });
    const { steps, calls } = fakeSteps();
    const resumed = installPack(deps({ steps, journal }), { ...QUERY, confirm: plan.planId });
    await expect(resumed).rejects.toBeInstanceOf(InstallResumeUnknownError);
    await expect(resumed).rejects.toMatchObject({
      code: "install-resume-unknown",
      hint: expect.stringContaining("without --confirm"),
    });
    expect(calls).toEqual([]);
  });
});
