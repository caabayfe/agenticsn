import { describe, expect, it } from "bun:test";
import {
  type AvailableApp,
  type InstallSteps,
  installPack,
  installPlanDocument,
  planInstall,
} from "@snagentic/core";
import { fakeSteps, memoryJournal } from "../support/install-fakes";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// A module that needs a store application the instance lacks (spec 011, I3).
const PACK: PackFixture = {
  pack: { id: "zt", version: "0.1.0", requires: { snagentic: ">=2.1.0" } },
  modules: {
    foundation: {
      label: "ZT: foundation",
      components: [{ kind: "plugin", id: "com.snc.incident" }],
    },
    specialist: {
      label: "ZT: specialist",
      dependsOn: ["foundation"],
      components: [
        { kind: "app", id: "sn_ztsd", minVersion: "3.0.0", entitlement: "licensed" },
        { kind: "app", id: "sn_aia", minVersion: "8.3.4" },
      ],
    },
  },
  files: {
    "modules/foundation/source/global/src/fluent/foundation.now.ts": "// foundation",
    "modules/specialist/source/global/src/fluent/specialist.now.ts": "// specialist",
  },
};

const QUERY = {
  pack: "zt",
  instance: { root: "/w", name: "everis2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.16.0",
  signal: new AbortController().signal,
};

const OFFER: readonly AvailableApp[] = [{ scope: "sn_ztsd", version: "3.3.3", blocked: false }];

const INSTALLED_APPS = [{ scope: "sn_aia", active: "true", version: "8.3.6" }];

function deps(
  extra: {
    offer?: readonly AvailableApp[];
    asked?: string[][];
    steps?: InstallSteps;
    pack?: PackFixture;
    apps?: readonly Record<string, string>[];
  } = {},
) {
  const clock = { ms: 0 };
  return {
    packs: memoryPacks({ zt: packFiles(extra.pack ?? PACK) }),
    inventory: {
      read: async (_root: string, _instance: string, file: string) =>
        file === "plugins"
          ? [{ id: "com.snc.incident", active: "active", version: "1.0.0" }]
          : (extra.apps ?? INSTALLED_APPS),
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
      available: async (scopes: readonly string[]) => {
        extra.asked?.push([...scopes]);
        return extra.offer ?? OFFER;
      },
    },
    templates: {
      tracked: async () => false,
      read: async () => null,
      parse: () => ({ columns: [], rows: [] }),
    },
    schema: { ready: async () => true, fieldsOf: async () => [], refresh: () => {} },
    steps: extra.steps ?? fakeSteps().steps,
    journal: memoryJournal().journal,
    now: () => {
      clock.ms += 1000;
      return new Date(clock.ms);
    },
  };
}

describe("installing store applications (spec 011, I3)", () => {
  it("asks the store only for the selected modules' applications", async () => {
    const asked: string[][] = [];
    await planInstall(deps({ asked }), QUERY);
    expect(asked).toEqual([["sn_ztsd", "sn_aia"]]);
  });

  it("does not ask the store when no selected module needs an application", async () => {
    const asked: string[][] = [];
    await planInstall(deps({ asked }), { ...QUERY, modules: ["foundation"] });
    expect(asked).toEqual([]);
  });

  it("plans an application the store offers as installed at the store's version", async () => {
    const plan = await planInstall(deps(), QUERY);
    expect(plan.components.map((c) => [c.id, c.state, c.version, c.action])).toEqual([
      ["com.snc.incident", "active", "1.0.0", "none"],
      ["sn_ztsd", "available", "3.3.3", "install"],
      ["sn_aia", "active", "8.3.6", "none"],
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.modules.map((m) => m.id)).toEqual(["foundation", "specialist"]);
  });

  it("skips the module when the store does not offer its application", async () => {
    const plan = await planInstall(deps({ offer: [] }), QUERY);
    expect(plan.skipped).toEqual([
      {
        id: "specialist",
        reason:
          "needs app sn_ztsd: not on the instance: it needs an entitlement this instance lacks",
      },
    ]);
  });

  it("changes the plan id when the store's version changes, so the admin approves the version installed", async () => {
    const one = await planInstall(deps(), QUERY);
    const two = await planInstall(
      deps({ offer: [{ scope: "sn_ztsd", version: "3.4.0", blocked: false }] }),
      QUERY,
    );
    expect(one.planId).not.toBe(two.planId);
  });

  it("installs the application before the modules, then pulls", async () => {
    const { steps, calls } = fakeSteps();
    const plan = await planInstall(deps(), QUERY);
    const result = await installPack(deps({ steps }), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    expect(calls.slice(0, 3)).toEqual(["install sn_ztsd 3.3.3", "refresh", "add foundation"]);
    expect(result.steps[0]).toMatchObject({ step: "install sn_ztsd 3.3.3", outcome: "done" });
  });

  it("tells the admin which applications it installs, and that it cannot remove them", async () => {
    const document = installPlanDocument(await planInstall(deps(), QUERY));
    expect(document).toContain("1 store application(s) installed");
    expect(document).toContain("| `sn_ztsd` | app | specialist | available 3.3.3 | **install**:");
    expect(document).toContain("Installing a store application cannot be undone by the install");
  });
});

// DEX: an application that brings its demo data, and a demo module (ADR-0048).
const DEMO_PACK: PackFixture = {
  ...PACK,
  modules: {
    ...PACK.modules,
    dex: {
      label: "ZT: dex",
      dependsOn: ["foundation"],
      components: [{ kind: "app", id: "sn_dex", demoData: true }],
    },
    "dex-demo": {
      label: "ZT: dex demo",
      demo: true,
      dependsOn: ["dex"],
      components: [{ kind: "app", id: "sn_dex_demo_data" }],
    },
  },
  files: {
    ...PACK.files,
    "modules/dex/source/global/src/fluent/dex.now.ts": "// dex",
    "modules/dex-demo/source/global/src/fluent/dex-demo.now.ts": "// dex demo",
  },
};
const DEX_OFFER: readonly AvailableApp[] = [
  ...OFFER,
  { scope: "sn_dex", version: "5.3.2", blocked: false },
  { scope: "sn_dex_demo_data", version: "5.0.2", blocked: false },
];
const CUSTOMER = { ...QUERY, source: { kind: "directory", directory: "/data" } as const };
const demoDeps = (extra: Parameters<typeof deps>[0] = {}) =>
  deps({ pack: DEMO_PACK, offer: DEX_OFFER, ...extra });

describe("--demo: demo modules and store applications' demo data (ADR-0048)", () => {
  it("with --demo, installs an application that declares demo data with it, and the demo modules", async () => {
    const plan = await planInstall(demoDeps(), QUERY);
    expect(plan.modules.map((m) => m.id)).toEqual(["foundation", "dex", "dex-demo", "specialist"]);
    expect(plan.demoOnly).toEqual([]);
    expect(plan.components.filter((c) => c.demoData === true).map((c) => c.id)).toEqual(["sn_dex"]);
  });

  it("with --data, leaves the demo modules out, names them, and loads no application's demo data", async () => {
    const asked: string[][] = [];
    const plan = await planInstall(demoDeps({ asked }), CUSTOMER);
    expect(plan.modules.map((m) => m.id)).toEqual(["foundation", "dex", "specialist"]);
    expect(plan.demoOnly).toEqual(["dex-demo"]);
    expect(plan.components.some((c) => c.demoData === true)).toBe(false);
    expect(asked).toEqual([["sn_dex", "sn_ztsd", "sn_aia"]]);
  });

  it("loads no application's demo data on an instance that is not development", async () => {
    const plan = await planInstall(demoDeps(), {
      ...QUERY,
      instance: { ...QUERY.instance, kind: "test" },
    });
    expect(plan.components.some((c) => c.demoData === true)).toBe(false);
  });

  it("refuses a demo module named without --demo", async () => {
    const plan = await planInstall(demoDeps(), { ...CUSTOMER, modules: ["dex-demo"] });
    expect(plan.problems).toContain(
      "dex-demo is a demo module: install it with --demo, or leave it out",
    );
  });

  it("warns that an application already installed cannot load its demo data any more", async () => {
    const plan = await planInstall(
      demoDeps({
        apps: [...INSTALLED_APPS, { scope: "sn_dex", active: "true", version: "5.3.2" }],
      }),
      QUERY,
    );
    expect(plan.warnings).toContain(
      "sn_dex is already installed: its demo data loads only when it is installed, so --demo cannot add it",
    );
  });

  it("changes the plan id with the demo choice", async () => {
    const demo = await planInstall(demoDeps(), QUERY);
    const plain = await planInstall(demoDeps({ pack: PACK, offer: OFFER }), QUERY);
    expect(demo.planId).not.toBe(plain.planId);
  });

  it("installs the application with its demo data", async () => {
    const { steps, calls } = fakeSteps();
    const plan = await planInstall(demoDeps(), QUERY);
    const result = await installPack(demoDeps({ steps }), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    expect(calls.slice(0, 4)).toEqual([
      "install sn_dex 5.3.2 with demo data",
      "install sn_dex_demo_data 5.0.2",
      "install sn_ztsd 3.3.3",
      "refresh",
    ]);
  });

  it("tells the admin which applications bring demo data, and which demo modules it leaves out", async () => {
    const demo = installPlanDocument(await planInstall(demoDeps(), QUERY));
    expect(demo).toContain(
      "| `sn_dex` | app | dex | available 5.3.2 | **install with its demo data**:",
    );
    expect(demo).toContain("Demo data a store application loads cannot be removed by snagentic");
    const customer = installPlanDocument(await planInstall(demoDeps(), CUSTOMER));
    expect(customer).toContain(
      "**Demo modules left out** (installed only with `--demo`): dex-demo",
    );
  });
});

// A demo module whose loader refuses until its property is on (ADR-0049).
const SETTINGS_PACK: PackFixture = {
  ...DEMO_PACK,
  modules: {
    ...DEMO_PACK.modules,
    "dex-demo": {
      label: "ZT: dex demo",
      demo: true,
      dependsOn: ["dex"],
      components: [{ kind: "app", id: "sn_dex_demo_data" }],
      demoSettings: { "nttdata.acc.dex_demo.allowed": "true" },
    },
  },
};
const settingsDeps = (extra: Parameters<typeof deps>[0] = {}) =>
  demoDeps({ pack: SETTINGS_PACK, ...extra });

describe("--demo turns on the demo modules it installs (ADR-0049)", () => {
  it("plans the demo modules' settings with --demo, and none with --data", async () => {
    const demo = await planInstall(settingsDeps(), QUERY);
    expect(demo.demoSettings).toEqual({ "nttdata.acc.dex_demo.allowed": "true" });
    const customer = await planInstall(settingsDeps(), CUSTOMER);
    expect(customer.demoSettings).toEqual({});
    expect(demo.planId).not.toBe((await planInstall(demoDeps(), QUERY)).planId);
  });

  it("refuses demo settings on a module that is not a demo module", async () => {
    const pack: PackFixture = {
      ...DEMO_PACK,
      modules: {
        ...DEMO_PACK.modules,
        dex: {
          label: "ZT: dex",
          dependsOn: ["foundation"],
          components: [{ kind: "app", id: "sn_dex", demoData: true }],
          demoSettings: { "nttdata.acc.dex.allowed": "true" },
        },
      },
    };
    await expect(planInstall(demoDeps({ pack }), QUERY)).rejects.toThrow(
      "module dex: demoSettings is for demo modules only",
    );
  });

  it("refuses --demo on an instance that is not development, and plans no settings for it", async () => {
    const plan = await planInstall(settingsDeps(), {
      ...QUERY,
      instance: { ...QUERY.instance, kind: "test" },
    });
    expect(plan.problems).toContain("--demo is for development instances only");
    expect(plan.demoSettings).toEqual({});
  });

  it("sets them once the modules are delivered, so a module's own update set cannot turn them off", async () => {
    const { steps, calls, demoSettings } = fakeSteps();
    const plan = await planInstall(settingsDeps(), QUERY);
    const result = await installPack(settingsDeps({ steps }), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    expect(demoSettings).toEqual(["nttdata.acc.dex_demo.allowed"]);
    const at = result.steps.findIndex((s) => s.step === "turn on the demo modules");
    expect(at).toBeGreaterThan(result.steps.findIndex((s) => s.step === "module dex-demo"));
    expect(result.steps[at]?.detail).toBe(
      "set nttdata.acc.dex_demo.allowed, in an update set set to ignore",
    );
    expect(calls.indexOf("demo settings")).toBeGreaterThan(
      calls.lastIndexOf("push p-ZT: dex demo"),
    );
  });

  it("tells the admin which properties it turns on, and that they are never promoted", async () => {
    const document = installPlanDocument(await planInstall(settingsDeps(), QUERY));
    expect(document).toContain(
      "**Demo modules turned on.** After the modules, the install sets `nttdata.acc.dex_demo.allowed` = `true`",
    );
  });
});
