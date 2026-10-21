import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  InstallBlockedError,
  type InstallJournal,
  InstallLockedError,
  InstallPlanChangedError,
  type InstallRecord,
  type InstallSteps,
  type InventoryReader,
  installPack,
  installPlanDocument,
  type PackWorkspace,
  planInstall,
  plannedComponents,
} from "@snagentic/core";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

// The ITSM shape, small: a foundation with data and a component, and a module that needs it.
const PACK: PackFixture = {
  pack: {
    id: "itsm",
    version: "0.1.0",
    requires: { snagentic: ">=2.1.0" },
    profiles: { core: ["foundation"] },
  },
  modules: {
    foundation: {
      label: "ITSM: foundation",
      components: [{ kind: "plugin", id: "com.snc.cmdb.csdm" }],
      data: [
        {
          entity: "group",
          table: "u_acc_imp_group",
          target: "sys_user_group",
          key: ["name"],
          anchors: true,
          columns: { name: { required: true } },
        },
      ],
    },
    incident: {
      label: "ITSM: incident",
      dependsOn: ["foundation"],
      components: [{ kind: "plugin", id: "com.snc.incident.mim" }],
    },
  },
  files: {
    "modules/foundation/source/global/src/fluent/imports.now.ts": "// imports",
    "modules/foundation/data/demo/group.csv": "name\nService Desk\n",
    "modules/incident/source/global/src/fluent/incident.now.ts": "// incident",
  },
};

const INSTANCE = { root: "/w", name: "pdi2", kind: "development" };

function inventory(states: Record<string, "active" | "inactive">): InventoryReader {
  return {
    read: async (_root, _instance, file) =>
      file === "plugins"
        ? Object.entries(states).map(([id, active]) => ({ id, active, version: "1.0.0" }))
        : [],
  };
}

const templates: DataTemplates = {
  tracked: async () => false,
  read: async () => null,
  parse: (text) => {
    const [head = "", ...rows] = text.trim().split("\n");
    return { columns: head.split(","), rows: rows.map((r) => r.split(",")) };
  },
};

const workspace = (mirror = "m1", held: readonly string[] = []): PackWorkspace => ({
  mirrorCommit: async () => mirror,
  includes: async () => true,
  present: async (paths) => paths.filter((p) => held.includes(p)),
  parse: (text) => JSON.parse(text),
  previous: async () => ({ written: [], kept: [] }),
  commit: async () => "c",
  merge: async () => ({ branch: "b", conflicts: [] }),
});

function fakeSteps(
  options: {
    notApplied?: Record<string, number>;
    nothingFor?: string[];
    customized?: string[];
    absent?: string[];
  } = {},
) {
  const calls: string[] = [];
  const owned: string[] = [];
  const files = new Map<string, string>();
  const steps: InstallSteps = {
    activatePlugin: async (id) => {
      calls.push(`activate ${id}`);
      return { seconds: 3 };
    },
    refresh: async () => {
      calls.push("refresh");
    },
    add: async (modules) => {
      calls.push(`add ${modules.join("+")}`);
      return { copied: [`source/global/src/fluent/${modules.at(-1)}.now.ts`], conflicts: [] };
    },
    keys: async (paths) => {
      calls.push(`keys ${paths.length}`);
    },
    takeOver: async (records) => {
      calls.push(`take-over ${records.length}`);
      const customized = records
        .filter((r) => (options.customized ?? []).includes(r.sysId))
        .map((r) => `${r.table} ${r.sysId}`);
      const absent = records
        .filter((r) => (options.absent ?? []).includes(r.sysId))
        .map((r) => `${r.table} ${r.sysId}`);
      return {
        taken: records.length - customized.length - absent.length,
        customized,
        absent,
      };
    },
    planPush: async (label, _signal, own) => {
      calls.push(`plan ${label}`);
      owned.push(...own);
      const nothing = (options.nothingFor ?? []).some((m) => label.includes(m));
      return { planId: `p-${label}`, ready: !nothing, units: nothing ? 0 : 5, problems: [] };
    },
    push: async (planId, label) => {
      calls.push(`push ${planId}`);
      const notApplied =
        Object.entries(options.notApplied ?? {}).find(([m]) => label.includes(m))?.[1] ?? 0;
      return { units: 5, notApplied, notCaptured: 0, updateSets: [`snagentic: ${label}`] };
    },
    load: async (modules) => {
      calls.push(`load ${modules.join("+")}`);
      return {
        entities: [
          {
            entity: "group",
            counts: { inserted: 1, updated: 0, ignored: 0, skipped: 0, error: 0 },
            failed: [],
          },
        ],
        stopped: false,
      };
    },
    writeFile: async (path, text) => {
      files.set(path, text);
    },
    commit: async (paths) => {
      calls.push(`commit ${paths.length}`);
      return "r1";
    },
  };
  return { steps, calls, files, owned };
}

function memoryJournal(start: InstallRecord | null = null, locked = false) {
  const state = { record: start, locked, cleared: false };
  const journal: InstallJournal = {
    read: async () => state.record,
    write: async (r) => {
      state.record = r;
    },
    clear: async () => {
      state.record = null;
      state.cleared = true;
    },
    lock: async () => !state.locked,
    unlock: async () => {},
  };
  return { journal, state };
}

const deps = (
  states: Record<string, "active" | "inactive">,
  extra: { steps?: InstallSteps; journal?: InstallJournal; mirror?: string } = {},
) => {
  const clock = { ms: 0 };
  return {
    packs: memoryPacks({ itsm: packFiles(PACK) }),
    inventory: inventory(states),
    workspace: workspace(extra.mirror),
    templates,
    // The fixture declares no platform fields: the mirror's schema is never asked.
    schema: { ready: async () => true, fieldsOf: async () => [] },
    steps: extra.steps ?? fakeSteps().steps,
    journal: extra.journal ?? memoryJournal().journal,
    now: () => {
      clock.ms += 1000;
      return new Date(clock.ms);
    },
  };
};

const WITH_ADOPT: PackFixture = {
  ...PACK,
  files: {
    ...PACK.files,
    "modules/foundation/adopt.yaml": JSON.stringify([
      { table: "sys_properties", sys_id: "a".repeat(32), note: "set the value to true" },
    ]),
  },
};

const ACTIVE = { "com.snc.cmdb.csdm": "active", "com.snc.incident.mim": "active" } as const;

const QUERY = {
  pack: "itsm",
  instance: INSTANCE,
  source: { kind: "demo" } as const,
  snagentic: "2.2.0",
  signal: new AbortController().signal,
};

describe("planning an install (ADR-0038, items 2 and 3)", () => {
  it("lists each component's action, each module's update set and files, and the data to load", async () => {
    const plan = await planInstall(
      deps({ "com.snc.cmdb.csdm": "inactive", "com.snc.incident.mim": "active" }),
      QUERY,
    );
    expect(plan.components.map((c) => [c.id, c.action, c.modules])).toEqual([
      ["com.snc.cmdb.csdm", "activate", ["foundation"]],
      ["com.snc.incident.mim", "none", ["incident"]],
    ]);
    expect(plan.modules.map((m) => [m.id, m.label, m.files])).toEqual([
      ["foundation", "ITSM: foundation 0.1.0", ["source/global/src/fluent/imports.now.ts"]],
      ["incident", "ITSM: incident 0.1.0", ["source/global/src/fluent/incident.now.ts"]],
    ]);
    expect(plan.data).toEqual({
      source: "demo",
      entities: [
        { entity: "group", module: "foundation", target: "sys_user_group", rows: 1, anchors: true },
      ],
    });
    expect(plan.problems).toEqual([]);
  });

  it("names an unknown profile and every template problem as blocking", async () => {
    const broken: PackFixture = {
      ...PACK,
      files: {
        ...PACK.files,
        "modules/foundation/data/demo/group.csv": "name\nService Desk\nService Desk\n",
      },
    };
    const plan = await planInstall(
      {
        ...deps({ "com.snc.cmdb.csdm": "active", "com.snc.incident.mim": "active" }),
        packs: memoryPacks({ itsm: packFiles(broken) }),
      },
      { ...QUERY, profile: "nope" },
    );
    expect(plan.problems).toEqual(["the pack has no profile nope"]);
    const all = await planInstall(
      {
        ...deps({ "com.snc.cmdb.csdm": "active", "com.snc.incident.mim": "active" }),
        packs: memoryPacks({ itsm: packFiles(broken) }),
      },
      QUERY,
    );
    expect(all.problems).toEqual(["data group: row 2 (Service Desk): the key repeats row 1"]);
  });

  it("selects a profile's modules only", async () => {
    const plan = await planInstall(deps({ "com.snc.cmdb.csdm": "active" }), {
      ...QUERY,
      profile: "core",
    });
    expect(plan.modules.map((m) => m.id)).toEqual(["foundation"]);
  });

  it("blocks on a component it cannot install, naming the module that needs it", async () => {
    const plan = await planInstall(deps({ "com.snc.cmdb.csdm": "active" }), QUERY);
    expect(plan.problems).toEqual([
      "plugin com.snc.incident.mim (incident): not on the instance: the platform's installer cannot reach it",
    ]);
  });

  it("keeps its id for the same pack and instance, and changes it when either changes", async () => {
    const states = { "com.snc.cmdb.csdm": "active", "com.snc.incident.mim": "active" } as const;
    const a = await planInstall(deps(states), QUERY);
    expect((await planInstall(deps(states), QUERY)).planId).toBe(a.planId);
    expect((await planInstall(deps(states, { mirror: "m2" }), QUERY)).planId).not.toBe(a.planId);
    expect(
      (await planInstall(deps({ ...states, "com.snc.cmdb.csdm": "inactive" }), QUERY)).planId,
    ).not.toBe(a.planId);
  });

  it("writes a document an admin can approve: the plan id, each change and the command", async () => {
    const plan = await planInstall(
      deps({ "com.snc.cmdb.csdm": "inactive", "com.snc.incident.mim": "active" }),
      QUERY,
    );
    const text = installPlanDocument(plan);
    expect(text).toContain(`**Plan id:** \`${plan.planId}\``);
    expect(text).toContain(
      "| `com.snc.cmdb.csdm` | plugin | foundation | inactive 1.0.0 | **activate**",
    );
    expect(text).toContain("snagentic: ITSM: foundation 0.1.0");
    expect(text).toContain(
      "| group | sys_user_group | foundation | 1 | anchor sys_id, else business key |",
    );
    expect(text).toContain(`--demo --confirm ${plan.planId}`);
  });
});

describe("deciding what the install does with each component", () => {
  const report = (component: Record<string, unknown>) => ({
    problems: [],
    warnings: [],
    capabilities: [
      {
        id: "m",
        state: "needs-components" as const,
        next: [],
        components: [
          {
            kind: "plugin" as const,
            id: "x",
            state: "active" as const,
            version: "1",
            minVersion: null,
            entitlement: "free" as const,
            ...component,
          },
        ],
      },
    ],
  });
  const decided = (component: Record<string, unknown>) => {
    const [only] = plannedComponents(report(component));
    return [only?.action, only?.reason];
  };

  it("blocks a component it cannot install, saying what to do on the instance", () => {
    expect(decided({ state: "too-old", version: "1.0", minVersion: "2.0" })).toEqual([
      "blocked",
      "1.0 is older than 2.0: upgrade it on the instance",
    ]);
    expect(decided({ state: "missing", version: null, entitlement: "licensed" })).toEqual([
      "blocked",
      "not on the instance: it needs an entitlement this instance lacks",
    ]);
    expect(decided({ kind: "app", state: "inactive" })).toEqual([
      "blocked",
      "an inactive store application: activate it in Application Manager (spike S-F)",
    ]);
    expect(decided({ state: "inactive" })[0]).toBe("activate");
  });

  it("takes over a module's out-of-box records before planning its push", async () => {
    const { steps, calls } = fakeSteps();
    const packs = memoryPacks({ itsm: packFiles(WITH_ADOPT) });
    const ready = { ...deps(ACTIVE, { steps }), packs };
    const plan = await planInstall(ready, QUERY);
    await installPack(ready, { ...QUERY, confirm: plan.planId });
    const at = (call: string) => calls.indexOf(call);
    expect(at("take-over 1")).toBeGreaterThan(at("keys 1"));
    expect(at("take-over 1")).toBeLessThan(at("plan ITSM: foundation 0.1.0"));
  });

  it("stops at a module whose out-of-box record the client customized, naming it", async () => {
    const { steps, calls } = fakeSteps({ customized: ["a".repeat(32)] });
    const packs = memoryPacks({ itsm: packFiles(WITH_ADOPT) });
    const ready = { ...deps(ACTIVE, { steps }), packs };
    const plan = await planInstall(ready, QUERY);
    const result = await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(result.stopped?.step).toBe("module foundation");
    expect(result.stopped?.detail).toContain(
      `customized on the instance: sys_properties ${"a".repeat(32)}`,
    );
    expect(calls).not.toContain("plan ITSM: foundation 0.1.0");
  });

  it("stops at a module whose out-of-box record the instance lacks, naming it", async () => {
    const { steps } = fakeSteps({ absent: ["a".repeat(32)] });
    const packs = memoryPacks({ itsm: packFiles(WITH_ADOPT) });
    const ready = { ...deps(ACTIVE, { steps }), packs };
    const plan = await planInstall(ready, QUERY);
    const result = await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(result.stopped?.detail).toContain(
      `not on the instance: sys_properties ${"a".repeat(32)}`,
    );
  });

  it("creates a lacking out-of-box record the module restates whole and may create", async () => {
    const { steps, calls } = fakeSteps({ absent: ["a".repeat(32)] });
    const creates: PackFixture = {
      ...PACK,
      files: {
        ...PACK.files,
        "modules/foundation/adopt.yaml": JSON.stringify([
          {
            table: "contract_sla",
            sys_id: "a".repeat(32),
            note: "a demo SLA, restated inactive",
            when_absent: "create",
          },
        ]),
      },
    };
    const ready = { ...deps(ACTIVE, { steps }), packs: memoryPacks({ itsm: packFiles(creates) }) };
    const plan = await planInstall(ready, QUERY);
    expect(installPlanDocument(plan)).toContain(
      `| foundation | contract_sla ${"a".repeat(32)} | a demo SLA, restated inactive (created where the instance lacks it) |`,
    );
    const result = await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    expect(calls).toContain("plan ITSM: foundation 0.1.0");
  });

  it("names an adopt entry whose when_absent is not create", async () => {
    const wrong: PackFixture = {
      ...PACK,
      files: {
        ...PACK.files,
        "modules/foundation/adopt.yaml": JSON.stringify([
          { table: "contract_sla", sys_id: "a".repeat(32), note: "n", when_absent: "skip" },
        ]),
      },
    };
    const plan = await planInstall(
      { ...deps(ACTIVE), packs: memoryPacks({ itsm: packFiles(wrong) }) },
      QUERY,
    );
    expect(plan.problems.join("\n")).toContain(
      "modules/foundation/adopt.yaml: entry 1 when_absent can only be create",
    );
  });

  it("lists the out-of-box records a module customizes in the plan", async () => {
    const withAdopt: PackFixture = {
      ...PACK,
      files: {
        ...PACK.files,
        "modules/foundation/adopt.yaml": JSON.stringify([
          { table: "sys_properties", sys_id: "a".repeat(32), note: "set the value to true" },
        ]),
      },
    };
    const plan = await planInstall(
      {
        ...deps({ "com.snc.cmdb.csdm": "active", "com.snc.incident.mim": "active" }),
        packs: memoryPacks({ itsm: packFiles(withAdopt) }),
      },
      QUERY,
    );
    expect(plan.modules[0]?.adoptions).toEqual([
      {
        capability: "foundation",
        table: "sys_properties",
        sysId: "a".repeat(32),
        note: "set the value to true",
        whenAbsent: "stop",
      },
    ]);
    expect(installPlanDocument(plan)).toContain(
      `| foundation | sys_properties ${"a".repeat(32)} | set the value to true |`,
    );
  });
});

describe("running an install (ADR-0038, item 2)", () => {
  const READY = { "com.snc.cmdb.csdm": "inactive", "com.snc.incident.mim": "active" } as const;

  it("only plans and writes the plan without a confirmation", async () => {
    const { steps, calls, files } = fakeSteps();
    const result = await installPack(deps(READY, { steps }), QUERY);
    expect(calls).toEqual([]);
    expect([...files.keys()]).toEqual([
      `accelerators/installs/pdi2/itsm-${result.plan.planId}/plan.md`,
    ]);
  });

  it("refuses an id that is not the current plan's, and a plan with problems, changing nothing", async () => {
    const { steps, calls } = fakeSteps();
    await expect(
      installPack(deps(READY, { steps }), { ...QUERY, confirm: "0000" }),
    ).rejects.toBeInstanceOf(InstallPlanChangedError);
    const blocked = await planInstall(deps({ "com.snc.cmdb.csdm": "active" }), QUERY);
    await expect(
      installPack(deps({ "com.snc.cmdb.csdm": "active" }, { steps }), {
        ...QUERY,
        confirm: blocked.planId,
      }),
    ).rejects.toBeInstanceOf(InstallBlockedError);
    expect(calls).toEqual([]);
  });

  it("runs components, then each module into its update set, then data, then commits the report", async () => {
    const { steps, calls, files } = fakeSteps();
    const { journal, state } = memoryJournal();
    const plan = await planInstall(deps(READY), QUERY);
    const result = await installPack(deps(READY, { steps, journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    expect(calls).toEqual([
      "activate com.snc.cmdb.csdm",
      "refresh",
      "add foundation",
      "keys 1",
      "plan ITSM: foundation 0.1.0",
      "push p-ITSM: foundation 0.1.0",
      "add foundation+incident",
      "keys 1",
      "plan ITSM: incident 0.1.0",
      "push p-ITSM: incident 0.1.0",
      "load foundation+incident",
      "refresh",
      "commit 2",
    ]);
    expect(result.stopped).toBeNull();
    expect(result.steps.map((s) => [s.step, s.outcome])).toEqual([
      ["activate com.snc.cmdb.csdm", "done"],
      ["pull and integrate", "done"],
      ["module foundation", "done"],
      ["module incident", "done"],
      ["data", "done"],
      ["pull and integrate", "done"],
    ]);
    expect(files.get(`accelerators/installs/pdi2/itsm-${plan.planId}/report.md`)).toContain(
      "**Result:** installed",
    );
    expect(state.cleared).toBe(true);
  });

  it("skips a module the instance already holds as built", async () => {
    const { steps, calls } = fakeSteps({ nothingFor: ["foundation"] });
    const plan = await planInstall(deps(READY), QUERY);
    const result = await installPack(deps(READY, { steps }), { ...QUERY, confirm: plan.planId });
    expect(calls).not.toContain("push p-ITSM: foundation 0.1.0");
    expect(result.steps.find((s) => s.step === "module foundation")?.outcome).toBe("skipped");
  });

  it("stops at a module not applied as built, keeps the journal, and resumes with the approved id", async () => {
    const first = fakeSteps({ notApplied: { incident: 1 } });
    const { journal, state } = memoryJournal();
    const plan = await planInstall(deps(READY), QUERY);
    const stopped = await installPack(deps(READY, { steps: first.steps, journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    expect(stopped.stopped?.step).toBe("module incident");
    expect(first.calls).not.toContain("load foundation+incident");
    expect(state.record?.planId).toBe(plan.planId);
    // The instance changed (the plugin is active now): the approved id still resumes the run.
    const second = fakeSteps();
    const after = { ...READY, "com.snc.cmdb.csdm": "active" } as const;
    const resumed = await installPack(deps(after, { steps: second.steps, journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    expect(resumed.stopped).toBeNull();
    // The module the journal records as done is not planned again: its update set is closed
    // to this run, and the workspace already holds the later modules' files.
    expect(second.calls[0]).toBe("add foundation+incident");
    expect(second.calls).not.toContain("plan ITSM: foundation 0.1.0");
    expect(
      second.files.has(
        `accelerators/installs/pdi2/itsm-${plan.planId}/resume-${resumed.plan.planId}.md`,
      ),
    ).toBe(true);
  });

  it("resumes a stopped module in its own update set, though the workspace holds its files", async () => {
    const first = fakeSteps({ notApplied: { incident: 1 } });
    const { journal } = memoryJournal();
    const plan = await planInstall(deps(READY), QUERY);
    await installPack(deps(READY, { steps: first.steps, journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    // The stopped run added both modules to the workspace: neither was installed before it.
    const second = fakeSteps();
    const resumed = await installPack(
      {
        ...deps(READY, { steps: second.steps, journal }),
        workspace: workspace("m1", [
          "source/global/src/fluent/imports.now.ts",
          "source/global/src/fluent/incident.now.ts",
        ]),
      },
      { ...QUERY, confirm: plan.planId },
    );
    expect(second.calls.filter((c) => c.startsWith("plan"))).toEqual(["plan ITSM: incident 0.1.0"]);
    expect(resumed.steps.map((s) => s.step)).not.toContain(
      "modules already installed: foundation, incident",
    );
  });

  it("re-installs the modules already in the workspace together, under one upgrade update set", async () => {
    const { steps, calls } = fakeSteps();
    const ready = {
      ...deps(READY, { steps }),
      workspace: workspace("m1", ["source/global/src/fluent/imports.now.ts"]),
    };
    const plan = await planInstall(ready, QUERY);
    const result = await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(calls.filter((c) => c.startsWith("add") || c.startsWith("plan"))).toEqual([
      "add foundation",
      "plan itsm 0.1.0 upgrade",
      "add foundation+incident",
      "plan ITSM: incident 0.1.0",
    ]);
    expect(result.steps.map((s) => s.step)).toContain("modules already installed: foundation");
  });

  it("tells each plan which update sets are the install's own", async () => {
    const { steps, owned } = fakeSteps();
    const plan = await planInstall(deps(READY, { steps }), QUERY);
    await installPack(deps(READY, { steps }), { ...QUERY, confirm: plan.planId });
    expect([...new Set(owned)]).toEqual([
      "ITSM: foundation 0.1.0",
      "ITSM: incident 0.1.0",
      "itsm 0.1.0 upgrade",
    ]);
  });

  it("counts a module as installed when it gained files since its last add", async () => {
    const { steps, calls } = fakeSteps();
    const grown: PackFixture = {
      ...PACK,
      files: { ...PACK.files, "modules/incident/source/global/src/fluent/form.now.ts": "// new" },
    };
    const ready = {
      ...deps(READY, { steps }),
      packs: memoryPacks({ itsm: packFiles(grown) }),
      workspace: workspace("m1", [
        "source/global/src/fluent/imports.now.ts",
        "source/global/src/fluent/incident.now.ts",
      ]),
    };
    const plan = await planInstall(ready, QUERY);
    await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(calls.filter((c) => c.startsWith("plan"))).toEqual(["plan itsm 0.1.0 upgrade"]);
  });

  it("refuses to run while another install holds the instance's lock", async () => {
    const { journal } = memoryJournal(null, true);
    const plan = await planInstall(deps(READY), QUERY);
    await expect(
      installPack(deps(READY, { journal }), { ...QUERY, confirm: plan.planId }),
    ).rejects.toBeInstanceOf(InstallLockedError);
  });
});
