import { describe, expect, it } from "bun:test";
import {
  type DataTemplates,
  formFieldId,
  InstallBlockedError,
  type InstallJournal,
  InstallLockedError,
  InstallPlanChangedError,
  type InstallProgress,
  type InstallSteps,
  type InventoryReader,
  installPack,
  installPlanDocument,
  type ListState,
  type OpenSet,
  type PackWorkspace,
  planInstall,
  plannedComponents,
  type SectionState,
} from "@snagentic/core";
import { fakeSteps, memoryJournal } from "../support/install-fakes";
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

const workspace = (
  mirror = "m1",
  held: readonly string[] = [],
  reports: readonly string[] = [],
): PackWorkspace => ({
  mirrorCommit: async () => mirror,
  installReports: async () => reports,
  includes: async () => true,
  present: async (paths) => paths.filter((p) => held.includes(p)),
  parse: (text) => JSON.parse(text),
  previous: async () => ({ written: [], kept: [] }),
  commit: async () => "c",
  merge: async () => ({ branch: "b", conflicts: [] }),
});

const deps = (
  states: Record<string, "active" | "inactive">,
  extra: {
    steps?: InstallSteps;
    journal?: InstallJournal;
    mirror?: string;
    open?: readonly OpenSet[];
    reports?: readonly string[];
    progress?: (event: InstallProgress) => void;
  } = {},
) => {
  const clock = { ms: 0 };
  return {
    packs: memoryPacks({ itsm: packFiles(PACK) }),
    inventory: inventory(states),
    workspace: workspace(extra.mirror, [], extra.reports),
    updateSets: { open: async () => extra.open ?? [] },
    templates,
    // The fixture declares no platform fields: the mirror's schema is never asked.
    schema: { ready: async () => true, fieldsOf: async () => [], refresh: () => {} },
    steps: extra.steps ?? fakeSteps().steps,
    journal: extra.journal ?? memoryJournal().journal,
    ...(extra.progress === undefined ? {} : { progress: extra.progress }),
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
      domain: { separated: false },
      domainColumns: [],
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

  it("skips a module whose component it cannot install, and installs the rest (owner, 2026-10-24)", async () => {
    const plan = await planInstall(deps({ "com.snc.cmdb.csdm": "active" }), QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.modules.map((m) => m.id)).toEqual(["foundation"]);
    expect(plan.skipped).toEqual([
      {
        id: "incident",
        reason:
          "needs plugin com.snc.incident.mim: not on the instance: the platform's installer cannot reach it",
      },
    ]);
  });

  it("skips the modules depending on a skipped one, and leaves out their data", async () => {
    const chain: PackFixture = {
      ...PACK,
      modules: {
        ...PACK.modules,
        reporting: {
          label: "ITSM: reporting",
          dependsOn: ["incident"],
          data: [
            {
              entity: "target",
              table: "u_acc_imp_target",
              target: "pa_targets",
              key: ["name"],
              columns: { name: { required: true } },
            },
          ],
        },
      },
      files: { ...PACK.files, "modules/reporting/data/demo/target.csv": "name\nMTTR\n" },
    };
    const plan = await planInstall(
      {
        ...deps({ "com.snc.cmdb.csdm": "active" }),
        packs: memoryPacks({ itsm: packFiles(chain) }),
      },
      QUERY,
    );
    expect(plan.modules.map((m) => m.id)).toEqual(["foundation"]);
    expect(plan.skipped.map((s) => [s.id, s.reason])).toEqual([
      [
        "incident",
        "needs plugin com.snc.incident.mim: not on the instance: the platform's installer cannot reach it",
      ],
      ["reporting", "depends on incident, which is skipped"],
    ]);
    expect(plan.data.entities.map((e) => e.entity)).toEqual(["group"]);
    expect(plan.problems).toEqual([]);
  });

  it("blocks when every selected module would be skipped", async () => {
    const plan = await planInstall(deps({}), QUERY);
    expect(plan.modules).toEqual([]);
    expect(plan.problems).toEqual([
      "nothing to install: every selected module needs a component the install cannot install (see the skipped modules)",
    ]);
  });

  it("names the skipped modules and why in the document the admin approves", async () => {
    const plan = await planInstall(deps({ "com.snc.cmdb.csdm": "active" }), QUERY);
    const document = installPlanDocument(plan);
    expect(document).toContain("**Skipped modules**");
    expect(document).toContain(
      "| incident | needs plugin com.snc.incident.mim: not on the instance: the platform's installer cannot reach it |",
    );
  });

  it("installs only the modules it does not skip", async () => {
    const { steps, calls } = fakeSteps();
    const states = { "com.snc.cmdb.csdm": "active" } as const;
    const plan = await planInstall(deps(states), QUERY);
    await installPack(deps(states, { steps }), { ...QUERY, confirm: plan.planId });
    expect(calls.filter((c) => c.startsWith("add"))).toEqual(["add foundation"]);
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
        waitsOn: [],
        installable: true,
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
    const blocked = await planInstall(deps({}), QUERY);
    await expect(
      installPack(deps({}, { steps }), {
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

  it("says each step as it starts and ends, and where a module stands among the plan's", async () => {
    const events: InstallProgress[] = [];
    const plan = await planInstall(deps(READY), QUERY);
    const progress = (event: InstallProgress) => events.push(event);
    await installPack(deps(READY, { progress }), { ...QUERY, confirm: plan.planId });
    expect(events[0]).toEqual({
      kind: "begin",
      planId: plan.planId,
      title: "itsm 0.1.0 on pdi2",
      modules: 2,
      finished: 0,
    });
    expect(events.filter((e) => e.kind === "start").map((e) => [e.step, e.place])).toEqual([
      ["activate com.snc.cmdb.csdm", null],
      ["pull and integrate", null],
      ["module foundation", { first: 1, last: 1, total: 2 }],
      ["module incident", { first: 2, last: 2, total: 2 }],
      ["data", null],
      ["pull and integrate", null],
    ]);
    expect(events.at(-1)).toMatchObject({
      kind: "end",
      step: "pull and integrate",
      outcome: "done",
    });
  });

  it("counts the modules an earlier run finished when it resumes", async () => {
    const { journal } = memoryJournal();
    const plan = await planInstall(deps(READY), QUERY);
    const first = fakeSteps({ notApplied: { incident: 1 } });
    await installPack(deps(READY, { steps: first.steps, journal }), {
      ...QUERY,
      confirm: plan.planId,
    });
    const events: InstallProgress[] = [];
    const progress = (event: InstallProgress) => events.push(event);
    await installPack(deps(READY, { journal, progress }), { ...QUERY, confirm: plan.planId });
    expect(events[0]).toMatchObject({ kind: "begin", modules: 2, finished: 1 });
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
    expect(stopped.stopped).toMatchObject({
      step: "module incident",
      detail:
        '0 not captured, 1 not applied as built; sys_script_include U0: description: built "a", instance "b"',
    });
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

  it("stops at data rows not taken, with the platform's reason and what to do", async () => {
    const notTaken = {
      reason: "column schedule names a record service_offering.schedule does not find",
      action: "change schedule to name a record the instance has",
      rows: ["VPN", "ERP"],
    };
    const { steps } = fakeSteps({ notTaken });
    const plan = await planInstall(deps(READY), QUERY);
    const result = await installPack(deps(READY, { steps }), { ...QUERY, confirm: plan.planId });
    expect(result.stopped?.step).toBe("data");
    expect(result.stopped?.detail).toBe(
      `group: 2 row(s) not taken (VPN, ERP): ${notTaken.reason}; ${notTaken.action}`,
    );
  });

  it("stops at records the platform refused, naming the reason and what unblocks them", async () => {
    const action = "activate com.snc.pa.premium, then run the same command again";
    const { steps } = fakeSteps({
      refused: {
        incident: {
          table: "pa_indicators",
          reason: "permission denied",
          records: ["ACC MTTR", "ACC Backlog"],
          action,
        },
      },
    });
    const plan = await planInstall(deps(READY), QUERY);
    const result = await installPack(deps(READY, { steps }), { ...QUERY, confirm: plan.planId });
    expect(result.stopped?.step).toBe("module incident");
    expect(result.stopped?.detail).toBe(
      `the instance refused 2 pa_indicators record(s) (permission denied): ${action}`,
    );
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

// ADR-0038, section 6 (proposed amendment, 2026-10-22).
describe("an upgrade over the pack's earlier update sets still in progress", () => {
  const set = (name: string, parent = "") => ({
    sysId: `id ${name}`,
    name,
    parent,
    createdOn: "2026-10-18 10:00:00",
  });
  const UPGRADE: PackFixture = { ...PACK, pack: { ...PACK.pack, version: "0.3.1" } };
  const OPEN = [
    set("snagentic: itsm 0.3.0 upgrade"),
    set("snagentic: itsm 0.1.0 upgrade"),
    set("snagentic: itsm 0.1.0 upgrade [sn_sow_inc]", "id snagentic: itsm 0.1.0 upgrade"),
    set("snagentic: ITSM: foundation 0.3.1"),
    set("snagentic: someone's fix"),
  ];
  const upgradeDeps = (extra: Parameters<typeof deps>[1] = {}) => ({
    ...deps(ACTIVE, { open: OPEN, ...extra }),
    packs: memoryPacks({ itsm: packFiles(UPGRADE) }),
  });

  it("plans to complete the pack's older sets, oldest first, and leaves the others open", async () => {
    const plan = await planInstall(upgradeDeps(), QUERY);
    expect(plan.earlierSets.map((s) => s.name)).toEqual([
      "snagentic: itsm 0.1.0 upgrade",
      "snagentic: itsm 0.3.0 upgrade",
    ]);
    expect(plan.problems).toEqual([]);
  });

  it("finds a renamed module's set through the install reports in the workspace", async () => {
    const renamed = set("snagentic: ITSM: basics 0.1.0");
    const report = "| module basics | done | 2 unit(s) into snagentic: ITSM: basics 0.1.0 | 3 |";
    const plan = await planInstall(upgradeDeps({ open: [renamed], reports: [report] }), QUERY);
    expect(plan.earlierSets).toEqual([renamed]);
  });

  it("tells the admin which sets it completes and the order to promote them in", async () => {
    const text = installPlanDocument(await planInstall(upgradeDeps(), QUERY));
    expect(text).toContain("## 2. Customizations, by module");
    expect(text).toContain(
      "| 1 | snagentic: itsm 0.1.0 upgrade | completed by the install, before the first push |",
    );
    expect(text).toContain(
      "| 3 | snagentic: itsm 0.3.1 upgrade (modules already installed), then each new module's update set | this install |",
    );
    expect(text).not.toContain("| 4 |");
    expect(text).toContain("or complete an update set the plan does not list");
  });

  it("makes a new plan id when an earlier set is completed or opened since", async () => {
    const before = await planInstall(upgradeDeps(), QUERY);
    const after = await planInstall(upgradeDeps({ open: OPEN.slice(1) }), QUERY);
    expect(after.planId).not.toBe(before.planId);
  });

  it("completes them after the components and before the first push, once", async () => {
    const { steps, calls } = fakeSteps();
    const { journal, state } = memoryJournal();
    const ready = upgradeDeps({ steps, journal });
    const plan = await planInstall(ready, QUERY);
    const result = await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    const complete = "complete snagentic: itsm 0.1.0 upgrade, snagentic: itsm 0.3.0 upgrade";
    expect(calls.filter((c) => c.startsWith("complete"))).toEqual([complete]);
    expect(calls.indexOf(complete)).toBeLessThan(calls.findIndex((c) => c.startsWith("plan ")));
    expect(result.steps[0]).toMatchObject({
      step: "complete earlier update sets",
      outcome: "done",
      detail:
        "snagentic: itsm 0.1.0 upgrade, snagentic: itsm 0.3.0 upgrade: promote them before this install's update sets",
    });
    expect(state.cleared).toBe(true);
  });

  it("does not complete them again when a stopped run resumes", async () => {
    const { steps, calls } = fakeSteps();
    const ready = upgradeDeps({ steps });
    const plan = await planInstall(ready, QUERY);
    const done = {
      step: "complete earlier update sets",
      outcome: "done" as const,
      detail: "",
      seconds: 1,
    };
    const { journal } = memoryJournal({ planId: plan.planId, startedAt: "t", steps: [done] });
    await installPack({ ...ready, journal }, { ...QUERY, confirm: plan.planId });
    expect(calls.some((c) => c.startsWith("complete"))).toBe(false);
  });

  it("adds no step when no earlier set is open", async () => {
    const { steps, calls } = fakeSteps();
    const ready = upgradeDeps({ steps, open: [] });
    const plan = await planInstall(ready, QUERY);
    expect(installPlanDocument(plan)).not.toContain("Update sets, in promotion order");
    await installPack(ready, { ...QUERY, confirm: plan.planId });
    expect(calls.some((c) => c.startsWith("complete"))).toBe(false);
  });
});

describe("layouts a module adds to (ADR-0042)", () => {
  const CONTAINER = "454c3bdf53853010ae50ddeeff7b1263";
  const WITH_ENSURE: PackFixture = {
    ...PACK,
    files: {
      ...PACK.files,
      "modules/incident/ensure.yaml": JSON.stringify([
        {
          kind: "related_list",
          table: "incident",
          view: "Default view",
          list: "incident_task.incident",
          note: "Incident Tasks on the incident form",
        },
      ]),
    },
  };
  const ensureDeps = (steps: InstallSteps) => ({
    ...deps(ACTIVE, { steps }),
    packs: memoryPacks({ itsm: packFiles(WITH_ENSURE) }),
  });

  it("lists each fact in the plan, by table and view, without a sys_id", async () => {
    const plan = await planInstall(ensureDeps(fakeSteps().steps), QUERY);
    expect(plan.problems).toEqual([]);
    expect(plan.modules.find((m) => m.id === "incident")?.ensures).toMatchObject([
      { table: "incident", view: "Default view", list: "incident_task.incident" },
    ]);
    expect(installPlanDocument(plan)).toContain(
      "| incident | incident, Default view | related list incident_task.incident | Incident Tasks on the incident form |",
    );
  });

  it("reads the layout when the module is delivered, writes and commits its entries, and takes the container over", async () => {
    const layout: ListState = {
      container: CONTAINER,
      view: "Default view",
      entries: [{ sysId: "e1", relatedList: "task_sla.task", position: 7 }],
    };
    const { steps, calls, files } = fakeSteps({ layout });
    const plan = await planInstall(ensureDeps(steps), QUERY);
    await installPack(ensureDeps(steps), { ...QUERY, confirm: plan.planId });
    const generated = files.get("source/global/src/fluent/ensure-incident.now.ts") ?? "";
    expect(generated).toContain(
      `data: { list_id: '${CONTAINER}', related_list: 'incident_task.incident', position: 8 }`,
    );
    expect(files.get(`source/global/src/fluent/ensure-list-${CONTAINER}.now.ts`)).toContain(
      `$id: '${CONTAINER}'`,
    );
    expect(generated).not.toContain(`$id: '${CONTAINER}'`);
    // The generated files' records get their keys too (SN-MNT-010), so keys come after them.
    const at = calls.indexOf("layouts 1");
    expect(calls.slice(at, at + 5)).toEqual([
      "layouts 1",
      "commit 2",
      "keys 3",
      "take-over 1",
      "plan ITSM: incident 0.1.0",
    ]);
  });

  it("adds nothing when the list is already there, and stops on a container the client customized", async () => {
    const already: ListState = {
      container: CONTAINER,
      view: "Default view",
      entries: [{ sysId: "e1", relatedList: "incident_task.incident", position: 2 }],
    };
    const quiet = fakeSteps({ layout: already });
    const plan = await planInstall(ensureDeps(quiet.steps), QUERY);
    await installPack(ensureDeps(quiet.steps), { ...QUERY, confirm: plan.planId });
    expect([...quiet.files.keys()].some((p) => p.includes("ensure-"))).toBe(false);

    const missing: ListState = { container: CONTAINER, view: "Default view", entries: [] };
    const customized = fakeSteps({ layout: missing, customized: [CONTAINER] });
    const result = await installPack(ensureDeps(customized.steps), {
      ...QUERY,
      confirm: plan.planId,
    });
    expect(result.stopped?.detail).toContain(
      `customized on the instance: sys_ui_related_list ${CONTAINER}`,
    );
  });

  it("checks each list again after the install, after the pull", async () => {
    const already: ListState = {
      container: CONTAINER,
      view: "Default view",
      entries: [{ sysId: "e1", relatedList: "incident_task.incident", position: 2 }],
    };
    const { steps, calls } = fakeSteps({ layout: already });
    const plan = await planInstall(ensureDeps(steps), QUERY);
    const result = await installPack(ensureDeps(steps), { ...QUERY, confirm: plan.planId });
    expect(calls.slice(-3)).toEqual(["refresh", "layouts 1", "commit 2"]);
    expect(result.steps.at(-1)).toMatchObject({
      step: "check the layouts and forms",
      outcome: "done",
      detail: "1 of 1 hold",
    });
    const lost = fakeSteps({ layout: { ...already, entries: [] } });
    const again = await installPack(ensureDeps(lost.steps), { ...QUERY, confirm: plan.planId });
    expect(again.steps.at(-1)?.detail).toBe(
      "0 of 1 hold; no longer on the instance: incident Default view: related list incident_task.incident (incident) (install again to add them back)",
    );
  });
});

describe("fields a module adds to shipped forms (ADR-0042 form_field)", () => {
  const SECTION = "2da34abfc74230105a06a1e603c260ec";
  const RECORD = "accelerators/installs/pdi2/itsm-form-sections.json";
  const WITH_FIELD: PackFixture = {
    ...PACK,
    files: {
      ...PACK.files,
      "modules/incident/ensure.yaml": JSON.stringify([
        {
          kind: "form_field",
          table: "sc_task",
          view: "sow",
          section: "Catalog task",
          field: "comments",
          after: "work_notes",
          note: "workspace compose can post to the requester",
        },
      ]),
    },
  };
  const fieldDeps = (steps: InstallSteps) => ({
    ...deps(ACTIVE, { steps }),
    packs: memoryPacks({ itsm: packFiles(WITH_FIELD) }),
  });
  const section = (elements: readonly string[]): SectionState => ({
    sysId: SECTION,
    scope: { name: "sn_sow_req", sysId: "ff5e8e53c3a53010965e070e9140ddb2" },
    table: "sc_task",
    view: "sow",
    caption: "Catalog task",
    title: "false",
    header: "false",
    elements: elements.map((element, position) => ({
      sysId: `e${position}`,
      element,
      type: "",
      formatter: "",
      position,
    })),
    onView: elements,
  });

  it("lists each field in the plan by form and section, with the promotion note", async () => {
    const plan = await planInstall(fieldDeps(fakeSteps().steps), QUERY);
    expect(plan.problems).toEqual([]);
    const document = installPlanDocument(plan);
    expect(document).toContain(
      "| incident | sc_task, sow | Catalog task | comments after work_notes | workspace compose can post to the requester |",
    );
    expect(document).toContain("install the accelerator on each instance");
  });

  it("restates the section in its scope's project, made when missing, and takes it over though customized", async () => {
    const { steps, calls, files } = fakeSteps({
      section: section(["number", "work_notes", "state"]),
      noProject: ["sn_sow_req"],
      customized: [SECTION],
    });
    const plan = await planInstall(fieldDeps(steps), QUERY);
    const result = await installPack(fieldDeps(steps), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    const generated = files.get(`source/sn_sow_req/src/fluent/ensure-section-${SECTION}.now.ts`);
    expect(generated).toContain("element: 'work_notes', position: 1 }");
    expect(generated).toContain("element: 'comments', position: 2 }");
    expect(generated).toContain("element: 'state', position: 3 }");
    expect(JSON.parse(files.get(RECORD) ?? "{}")).toEqual({
      sections: [
        {
          module: "incident",
          sysId: SECTION,
          table: "sc_task",
          view: "sow",
          caption: "Catalog task",
        },
      ],
    });
    const at = calls.indexOf("sections 1");
    expect(calls.slice(at, at + 6)).toEqual([
      "sections 1",
      "project sn_sow_req",
      // The project's two files, the section and the record of sections; keys for the first three.
      "commit 4",
      "keys 4",
      "take-over 1",
      "plan ITSM: incident 0.1.0",
    ]);
  });

  it("changes nothing when the field is already on the form, or the instance lacks the section", async () => {
    for (const state of [section(["number", "comments"]), { ...section([]), sysId: null }]) {
      const { steps, calls, files } = fakeSteps({ section: state });
      const plan = await planInstall(fieldDeps(steps), QUERY);
      await installPack(fieldDeps(steps), { ...QUERY, confirm: plan.planId });
      expect([...files.keys()].some((p) => p.includes("ensure-section-"))).toBe(false);
      expect(calls).not.toContain("project sn_sow_req");
    }
  });

  // The record a first install with the field left, naming the module's section.
  const recorded = (sections: { sysId: string; caption: string }[]) =>
    JSON.stringify({
      sections: sections.map((s) => ({ module: "incident", table: "sc_task", view: "sow", ...s })),
    });
  const ownId = (capability: string, section: string, field: string) =>
    formFieldId("itsm", {
      capability,
      kind: "form_field",
      table: "sc_task",
      view: "sow",
      section,
      field,
      after: "",
      note: "",
    });

  it("takes a dropped field's own element off the section, and no one else's", async () => {
    const own = ownId("incident", "Catalog task", "u_old");
    const others = ownId("problem", "Catalog task", "u_theirs");
    const state = {
      ...section(["number", "u_old", "u_theirs", "u_client"]),
      elements: [
        { sysId: "e0", element: "number", type: "", formatter: "", position: 0 },
        { sysId: own, element: "u_old", type: "", formatter: "", position: 1 },
        { sysId: others, element: "u_theirs", type: "", formatter: "", position: 2 },
        // The client's own element of the same field name keeps its place.
        { sysId: "e3", element: "u_old", type: "", formatter: "", position: 3 },
      ],
    };
    const { steps, files } = fakeSteps({
      section: state,
      workspace: { [RECORD]: recorded([{ sysId: SECTION, caption: "Catalog task" }]) },
    });
    // The module's ensure.yaml no longer names the field.
    const plan = await planInstall(deps(ACTIVE, { steps }), QUERY);
    const result = await installPack(deps(ACTIVE, { steps }), { ...QUERY, confirm: plan.planId });
    expect(result.stopped).toBeNull();
    const generated = files.get(`source/sn_sow_req/src/fluent/ensure-section-${SECTION}.now.ts`);
    expect(generated).not.toContain(`$id: '${own}'`);
    expect(generated).toContain(`$id: '${others}'`);
    expect(generated).toContain("$id: 'e3'");
    expect(JSON.parse(files.get(RECORD) ?? "{}")).toEqual({ sections: [] });
  });

  it("moves a field to the section its fact now names, off the one it was in", async () => {
    const NOTES = "0123456789abcdef0123456789abcdef";
    const old = ownId("incident", "Notes", "comments");
    const notes: SectionState = {
      ...section(["comments"]),
      sysId: NOTES,
      caption: "Notes",
      elements: [{ sysId: old, element: "comments", type: "", formatter: "", position: 0 }],
      onView: ["number", "work_notes", "comments"],
    };
    const task = { ...section(["number", "work_notes"]), onView: notes.onView };
    const { steps, files } = fakeSteps({
      sectionOf: (fact) => (fact.section === "Notes" ? notes : task),
      workspace: { [RECORD]: recorded([{ sysId: NOTES, caption: "Notes" }]) },
    });
    const plan = await planInstall(fieldDeps(steps), QUERY);
    await installPack(fieldDeps(steps), { ...QUERY, confirm: plan.planId });
    const path = (id: string) => `source/sn_sow_req/src/fluent/ensure-section-${id}.now.ts`;
    expect(files.get(path(SECTION))).toContain("element: 'comments', position: 2 }");
    expect(files.get(path(NOTES))).not.toContain("element: 'comments'");
    expect(JSON.parse(files.get(RECORD) ?? "{}").sections).toEqual([
      {
        module: "incident",
        sysId: SECTION,
        table: "sc_task",
        view: "sow",
        caption: "Catalog task",
      },
    ]);
  });

  it("checks every field again after the install, naming one no longer on its form", async () => {
    const run = async (state: SectionState) => {
      const { steps } = fakeSteps({ section: state });
      const plan = await planInstall(fieldDeps(steps), QUERY);
      const result = await installPack(fieldDeps(steps), { ...QUERY, confirm: plan.planId });
      return result.steps.find((s) => s.step === "check the layouts and forms");
    };
    expect(await run(section(["number", "comments"]))).toMatchObject({
      outcome: "done",
      detail: "1 of 1 hold",
    });
    // The instance still lacks the field: a plugin replaced the section after the push.
    expect((await run(section(["number", "work_notes"])))?.detail).toBe(
      '0 of 1 hold; no longer on the instance: sc_task sow "Catalog task": field comments (incident) (install again to add them back)',
    );
    expect((await run({ ...section([]), sysId: null }))?.detail).toBe(
      '0 of 1 hold; skipped, not on this instance: sc_task sow "Catalog task": field comments (incident)',
    );
  });
});

describe("files an earlier version wrote that this one no longer ships (ADR-0026, M8)", () => {
  const OLD = "source/global/src/fluent/incident-lists.now.ts";
  const leftoverDeps = (held: readonly string[]) => {
    const base = deps(ACTIVE);
    return {
      ...base,
      workspace: {
        ...workspace("m1", held),
        previous: async () => ({
          written: ["source/global/src/fluent/incident.now.ts", OLD],
          kept: [],
        }),
      },
    };
  };

  it("names each one the workspace still holds and blocks the plan until it is removed, deleting nothing", async () => {
    const plan = await planInstall(leftoverDeps([OLD]), QUERY);
    expect(plan.leftovers).toEqual([OLD]);
    expect(plan.problems).toContain(
      `the workspace still holds 1 file this version no longer ships: remove it (git rm ${OLD}), commit, then plan again`,
    );
    const document = installPlanDocument(plan);
    expect(document).toContain("**Files this version no longer ships**");
    expect(document).toContain(`| \`${OLD}\` |`);
  });

  it("is clear once the file is removed, and never counts a file the pack still ships", async () => {
    const plan = await planInstall(leftoverDeps([]), QUERY);
    expect(plan.leftovers).toEqual([]);
    expect(plan.problems).toEqual([]);
    expect(installPlanDocument(plan)).not.toContain("no longer ships");
  });
});
