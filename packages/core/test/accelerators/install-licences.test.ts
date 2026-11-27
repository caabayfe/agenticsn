import { describe, expect, it } from "bun:test";
import { installPlanDocument, parseManifest, planInstall } from "@snagentic/core";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// The platform team states the client's licences, and the install installs only what they cover (ADR-0059).
const PACK: PackFixture = {
  pack: {
    id: "zt",
    version: "0.1.0",
    requires: { snagentic: ">=2.1.0" },
    licences: { "itsm-pro": "ITSM Professional", "itsm-std": "ITSM Standard" },
  },
  modules: {
    foundation: {
      label: "ZT: foundation",
      components: [{ kind: "plugin", id: "com.snc.incident" }],
    },
    problem: {
      label: "ZT: problem",
      dependsOn: ["foundation"],
      components: [
        { kind: "plugin", id: "com.snc.problem", entitlement: "licensed", licence: "itsm-std" },
      ],
    },
    analytics: {
      label: "ZT: analytics",
      dependsOn: ["foundation"],
      components: [
        { kind: "plugin", id: "com.snc.pa.premium", entitlement: "licensed", licence: "itsm-pro" },
      ],
    },
    "analytics-reports": {
      label: "ZT: analytics reports",
      dependsOn: ["analytics"],
      components: [],
    },
    assist: {
      label: "ZT: assist",
      components: [{ kind: "plugin", id: "com.snc.assist", entitlement: "licensed" }],
    },
  },
  files: Object.fromEntries(
    ["foundation", "problem", "analytics", "analytics-reports", "assist"].map((m) => [
      `modules/${m}/source/global/src/fluent/${m}.now.ts`,
      `// ${m}`,
    ]),
  ),
};

const QUERY = {
  pack: "zt",
  instance: { root: "/w", name: "pdi2", kind: "development" },
  source: { kind: "demo" } as const,
  snagentic: "2.25.0",
  signal: new AbortController().signal,
};

const deps = () => ({
  packs: memoryPacks({ zt: packFiles(PACK) }),
  inventory: {
    read: async (_root: string, _instance: string, file: string) =>
      file === "plugins"
        ? ["com.snc.incident", "com.snc.problem", "com.snc.pa.premium", "com.snc.assist"].map(
            (id) => ({
              id,
              active: "active",
              version: "1.0.0",
            }),
          )
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
  catalog: { available: async () => [] },
  templates: {
    tracked: async () => false,
    read: async () => null,
    parse: () => ({ columns: [], rows: [] }),
  },
  schema: { ready: async () => true, fieldsOf: async () => [], refresh: () => {} },
});

const plan = (licences?: readonly string[]) =>
  planInstall(deps(), { ...QUERY, ...(licences === undefined ? {} : { licences }) });

describe("an install states the client's licences (ADR-0059)", () => {
  it("leaves out a module no stated licence covers, and the modules that depend on it", async () => {
    const planned = await plan(["itsm-std", "com.snc.assist"]);
    expect(planned.problems).toEqual([]);
    expect(planned.modules.map((m) => m.id)).toEqual(["foundation", "assist", "problem"]);
    expect(planned.skipped).toEqual([
      {
        id: "analytics",
        reason: "needs the licence itsm-pro (ITSM Professional), which --licences does not state",
      },
      {
        id: "analytics-reports",
        reason: "depends on analytics, which the stated licences leave out",
      },
    ]);
  });

  it("covers a licensed component that names no licence by its own id", async () => {
    const planned = await plan(["itsm-std", "itsm-pro"]);
    expect(planned.skipped.map((m) => m.id)).toEqual(["assist"]);
    expect(planned.skipped[0]?.reason).toBe(
      "needs the licence com.snc.assist, which --licences does not state",
    );
  });

  it("refuses a stated licence the pack does not know, so a typo cannot install less than meant", async () => {
    expect((await plan(["itsm-prof"])).problems).toContain(
      "--licences names itsm-prof, which is no licence of the pack (itsm-pro, itsm-std) nor a licensed component of its modules",
    );
  });

  it("installs as before without --licences, naming the licences the selection needs", async () => {
    const planned = await plan();
    expect(planned.skipped).toEqual([]);
    expect(planned.warnings).toContain(
      "the selected modules need these licences: com.snc.assist, itsm-pro (ITSM Professional), itsm-std (ITSM Standard); state the client's with --licences to install only what they cover",
    );
  });

  it("makes the stated licences part of the plan id and of the approval command", async () => {
    const [none, stated, same] = [
      await plan(),
      await plan(["itsm-std", "itsm-pro", "com.snc.assist"]),
      await plan(["com.snc.assist", "itsm-pro", "itsm-std"]),
    ];
    expect(stated.planId).not.toBe(none.planId);
    expect(same.planId).toBe(stated.planId);
    expect(installPlanDocument(stated)).toContain(
      "--licences com.snc.assist itsm-pro itsm-std --confirm",
    );
  });
});

describe("a pack's licences in its manifest (ADR-0059)", () => {
  const manifest = (component: Record<string, unknown>) =>
    parseManifest({
      id: "zt",
      version: "0.1.0",
      requires: { snagentic: ">=2.1.0" },
      licences: { "itsm-pro": "ITSM Professional" },
      modules: {
        analytics: { label: "A", components: [{ kind: "plugin", id: "com.snc.pa", ...component }] },
      },
    });

  it("reads the pack's licences and the licence a licensed component names", () => {
    const outcome = manifest({ entitlement: "licensed", licence: "itsm-pro" });
    expect(outcome.ok && outcome.manifest.licences).toEqual({ "itsm-pro": "ITSM Professional" });
    expect(outcome.ok && outcome.manifest.capabilities[0]?.components[0]?.licence).toBe("itsm-pro");
  });

  it("refuses a licence the pack does not declare, and a licence on a free component", () => {
    expect(manifest({ entitlement: "licensed", licence: "itsm-prime" })).toEqual({
      ok: false,
      problems: [
        "module analytics: component 1: licence itsm-prime is not one of the pack's licences",
      ],
    });
    expect(manifest({ licence: "itsm-pro" })).toEqual({
      ok: false,
      problems: ["module analytics: component 1: licence is for licensed components only"],
    });
  });
});
