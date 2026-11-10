import { describe, expect, it } from "bun:test";
import {
  type InstallSteps,
  installPack,
  installReportDocument,
  PluginActivationFailedError,
  planInstall,
  StoreAppInstallFailedError,
  StoreAppInstallStateUnknownError,
} from "@snagentic/core";
import { fakeSteps, memoryJournal } from "../support/install-fakes";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// A licensed application the store offers, which the installer then refuses (pdi2, 2026-11-07:
// "Unable to download app package"): the install says so and goes on (owner, 2026-11-08).
const PACK: PackFixture = {
  pack: { id: "zt", version: "0.1.0", requires: { snagentic: ">=2.1.0" } },
  modules: {
    foundation: {
      label: "ZT: foundation",
      components: [{ kind: "plugin", id: "com.snc.incident" }],
    },
    experts: {
      label: "ZT: experts",
      dependsOn: ["foundation"],
      components: [{ kind: "app", id: "sn_adv", entitlement: "licensed" }],
    },
    "experts-reports": {
      label: "ZT: experts reports",
      dependsOn: ["experts"],
      components: [],
    },
    assist: {
      label: "ZT: assist",
      components: [{ kind: "plugin", id: "com.snc.assist", entitlement: "licensed" }],
    },
    swarm: {
      label: "ZT: swarm",
      components: [{ kind: "app", id: "sn_free" }],
    },
  },
  files: {
    "modules/foundation/source/global/src/fluent/foundation.now.ts": "// foundation",
    "modules/experts/source/global/src/fluent/experts.now.ts": "// experts",
    "modules/experts-reports/source/global/src/fluent/experts-reports.now.ts": "// reports",
    "modules/assist/source/global/src/fluent/assist.now.ts": "// assist",
    "modules/swarm/source/global/src/fluent/swarm.now.ts": "// swarm",
  },
};

const QUERY = {
  pack: "zt",
  instance: { root: "/w", name: "pdi2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.18.0",
  signal: new AbortController().signal,
};

const REFUSED = "Unable to download app package: operation=app_install, app=sn_adv";

function deps(steps: InstallSteps = fakeSteps().steps, journal = memoryJournal().journal) {
  const clock = { ms: 0 };
  return {
    packs: memoryPacks({ zt: packFiles(PACK) }),
    inventory: {
      read: async (_root: string, _instance: string, file: string) =>
        file === "plugins"
          ? [
              { id: "com.snc.incident", active: "active", version: "1.0.0" },
              { id: "com.snc.assist", active: "inactive", version: "1.0.0" },
            ]
          : [],
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
    catalog: {
      available: async () => [
        { scope: "sn_adv", version: "8.5.0", blocked: false },
        { scope: "sn_free", version: "1.2.0", blocked: false },
      ],
    },
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

// The fake installer, refusing what `refuse` names with the error it gives.
function refusing(refuse: Readonly<Record<string, Error>>) {
  const fake = fakeSteps();
  const steps: InstallSteps = {
    ...fake.steps,
    installApp: async (scope, version, demoData, signal) => {
      const error = refuse[scope];
      if (error !== undefined) throw error;
      return fake.steps.installApp(scope, version, demoData, signal);
    },
    activatePlugin: async (id, signal) => {
      const error = refuse[id];
      if (error !== undefined) throw error;
      return fake.steps.activatePlugin(id, signal);
    },
  };
  return { steps, calls: fake.calls };
}

async function run(refuse: Readonly<Record<string, Error>>) {
  const { steps, calls } = refusing(refuse);
  const plan = await planInstall(deps(), QUERY);
  const result = await installPack(deps(steps), { ...QUERY, confirm: plan.planId });
  return { plan, result, calls };
}

describe("a licensed component the instance refuses while the install runs", () => {
  it("skips the modules that need it and their dependents, and installs the rest", async () => {
    const { result, calls } = await run({
      sn_adv: new StoreAppInstallFailedError("sn_adv", "p1", REFUSED),
    });
    expect(result.stopped).toBeNull();
    expect(result.steps.find((s) => s.step === "install sn_adv 8.5.0")).toMatchObject({
      outcome: "skipped",
    });
    expect(result.steps.find((s) => s.step === "install sn_free 1.2.0")?.outcome).toBe("done");
    const delivered = result.steps.filter((s) => s.step.startsWith("module ")).map((s) => s.step);
    expect(delivered.sort()).toEqual(["module assist", "module foundation", "module swarm"]);
    expect(calls.some((c) => c.includes("experts"))).toBe(false);
    expect(result.steps.filter((s) => s.step.startsWith("skip module "))).toEqual([
      expect.objectContaining({
        step: "skip module experts",
        outcome: "skipped",
        detail: expect.stringContaining(
          `needs app sn_adv: the instance refused it (installing sn_adv failed: ${REFUSED}`,
        ),
      }),
      expect.objectContaining({
        step: "skip module experts-reports",
        outcome: "skipped",
        detail: "depends on experts, which is skipped",
      }),
    ]);
  });

  it("skips the module of a licensed plugin whose activation the instance refuses", async () => {
    const { result } = await run({
      "com.snc.assist": new PluginActivationFailedError("com.snc.assist", "p2", "not entitled"),
    });
    expect(result.stopped).toBeNull();
    expect(result.steps.find((s) => s.step === "activate com.snc.assist")?.outcome).toBe("skipped");
    expect(result.steps.some((s) => s.step === "skip module assist")).toBe(true);
    expect(result.steps.some((s) => s.step === "module experts")).toBe(true);
  });

  it("tells the admin what it left out and that running the install again adds it", async () => {
    const { plan, result } = await run({
      sn_adv: new StoreAppInstallFailedError("sn_adv", "p1", REFUSED),
    });
    const report = installReportDocument(
      plan,
      { planId: plan.planId, startedAt: "t", steps: result.steps },
      null,
    );
    expect(report).toContain(
      "- **Result:** installed without experts, experts-reports, which need a component the instance refused: run the install again once the instance is entitled",
    );
  });

  it("still stops at a free component the instance refuses", async () => {
    const { result } = await run({
      sn_free: new StoreAppInstallFailedError("sn_free", "p3", "dependency missing"),
    });
    expect(result.stopped?.step).toBe("install sn_free 1.2.0");
  });

  it("still stops when it loses a licensed component's answer, to follow it on the next run", async () => {
    const { result } = await run({
      sn_adv: new StoreAppInstallStateUnknownError("sn_adv", "timeout", "p4"),
    });
    expect(result.stopped?.step).toBe("install sn_adv 8.5.0");
  });
});
