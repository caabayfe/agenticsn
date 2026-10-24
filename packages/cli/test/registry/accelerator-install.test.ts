import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { InstallPlanChangedError } from "@snagentic/core";
import { CsvDataTemplates } from "../../src/adapters/accelerators/csv-data-templates";
import { DirectoryPackSource } from "../../src/adapters/accelerators/directory-pack-source";
import { fsWorkspaceFiles } from "../../src/adapters/fs/fs-workspace-files";
import { acceleratorInstall } from "../../src/registry/accelerator-install";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const PACKS = new DirectoryPackSource([
  resolve(import.meta.dir, "../../../../tests/fixtures/accelerators"),
]);

async function installing(data: Parameters<typeof instanceWorkspace>[0] = {}) {
  const { context, instance } = await instanceWorkspace(data);
  const written: string[] = [];
  return {
    written,
    instance,
    context: {
      ...context,
      packs: PACKS,
      dataTemplates: new CsvDataTemplates(),
      inventory: {
        read: async (_root: string, _instance: string, file: string) =>
          file === "plugins"
            ? [{ id: "com.snc.on_call_rotation", active: "active", version: "1.0.0" }]
            : [],
      },
      packWorkspace: () => ({
        installReports: async () => [],
        mirrorCommit: async () => "m1",
        includes: async () => true,
        present: async () => [],
        parse: (text: string) => JSON.parse(text),
        previous: async () => ({ written: [], kept: [] }),
        commit: async () => "c",
        merge: async () => ({ branch: "b", conflicts: [] }),
      }),
      installJournal: () => ({
        read: async () => null,
        write: async () => {},
        clear: async () => {},
        lock: async () => true,
        unlock: async () => {},
      }),
      workspaceFiles: {
        read: async () => null,
        write: async (path: string) => {
          written.push(path);
        },
      },
    },
  };
}

describe("accelerator install (ADR-0038)", () => {
  it("writes the plan for the admin and changes nothing without --confirm", async () => {
    const { context, written } = await installing();
    const { output } = await executeUseCase(
      acceleratorInstall,
      { pack: "minimal", instance: "pdi", profile: "all", demo: true },
      context,
    );
    expect(output).toMatchObject({
      modules: ["base", "extra"],
      problems: [],
      reportPath: null,
      steps: [],
    });
    const planId = (output as { planId: string }).planId;
    expect(written).toEqual([
      expect.stringContaining(`accelerators/installs/pdi/minimal-${planId}/plan.md`),
    ]);
    const text = acceleratorInstall.render(output as never, "text");
    expect(text).toContain(`--confirm ${planId}`);
  });

  it("blocks a module that reads a platform field until the mirror holds the instance's tables", async () => {
    const { context } = await installing();
    // A pack whose module declares the platform field it reads (plan gap G13).
    const files = new Map([
      [
        "accelerator.yaml",
        JSON.stringify({ id: "fields", version: "0.1.0", requires: { snagentic: ">=2.0.0" } }),
      ],
      [
        "modules/base/module.yaml",
        JSON.stringify({ label: "Fields: base", fields: [{ field: "incident.caused_by" }] }),
      ],
      ["modules/base/source/global/src/fluent/base.now.ts", "// base"],
    ]);
    const packs = {
      ids: async () => ["fields"],
      files: async () => files,
      parse: (text: string) => JSON.parse(text),
    };
    const { output } = await executeUseCase(
      acceleratorInstall,
      { pack: "fields", instance: "pdi", demo: true },
      { ...context, packs },
    );
    expect((output as { problems: string[] }).problems).toContain(
      "pull pdi first: the mirror holds no tables, so the fields the modules read cannot be checked",
    );
  });

  it("completes the pack's earlier update sets on the instance before anything else", async () => {
    const earlier = "e".repeat(32);
    const installed = await installing({
      sys_update_set: [
        {
          sys_id: earlier,
          name: "snagentic: snagentic test pack: base 0.9.0",
          state: "in progress",
          parent: "",
        },
        {
          sys_id: "f".repeat(32),
          name: "snagentic: someone's fix",
          state: "in progress",
          parent: "",
        },
      ],
    });
    // The run commits its plan and report: they must be on disk.
    const context = { ...installed.context, workspaceFiles: fsWorkspaceFiles };
    const { instance } = installed;
    const input = { pack: "minimal", instance: "pdi", profile: "core", demo: true };
    const { output: plan } = await executeUseCase(acceleratorInstall, input, context);
    const planId = (plan as { planId: string }).planId;
    const { output } = await executeUseCase(
      acceleratorInstall,
      { ...input, confirm: planId },
      context,
    );
    expect((output as { steps: { step: string }[] }).steps[0]?.step).toBe(
      "complete earlier update sets",
    );
    expect(instance.writes[0]).toBe("update sys_update_set state=complete");
    const states = (instance.tables["sys_update_set"] ?? []).map((r) => [r["name"], r["state"]]);
    expect(states).toEqual([
      ["snagentic: snagentic test pack: base 0.9.0", "complete"],
      ["snagentic: someone's fix", "in progress"],
    ]);
  });

  it("refuses a confirmation that is not the current plan's id", async () => {
    const { context } = await installing();
    const run = executeUseCase(
      acceleratorInstall,
      {
        pack: "minimal",
        instance: "pdi",
        profile: "core",
        demo: true,
        confirm: "0000000000000000",
      },
      context,
    );
    await expect(run).rejects.toBeInstanceOf(InstallPlanChangedError);
  });

  // The plan pdi3 gave on 2026-10-24, shortened.
  const VIEW = {
    pack: "itsm",
    version: "0.8.1",
    instance: "pdi3",
    planId: "adc383e455869b0c",
    planPath: "accelerators/installs/pdi3/itsm-adc383e455869b0c/plan.md",
    reportPath: null,
    problems: [],
    warnings: [],
    modules: [
      "foundation",
      "incident-core",
      "incident-problem",
      "incident-analytics",
      "major-incident",
    ],
    activates: [{ id: "com.snc.pa.premium", modules: ["incident-analytics"] }],
    missingFields: [
      {
        field: "incident.problem_id",
        from: "com.snc.incident",
        blocking: false,
        modules: [
          {
            module: "incident-problem",
            effect: "the problem is linked only as first reported by the incident",
          },
          {
            module: "major-incident",
            effect: "the problem is linked only as first reported by the major incident",
          },
        ],
      },
    ],
    notes: ["tested on australia only"],
    steps: [],
    stopped: null,
    commit: null,
  };

  it("shows the plan in sections: modules, activations, missing fields, warnings, then the next step", () => {
    expect(acceleratorInstall.render(VIEW, "text").split("\n")).toEqual([
      "Install plan adc383e455869b0c: itsm 0.8.1 on pdi3",
      "  review: accelerators/installs/pdi3/itsm-adc383e455869b0c/plan.md",
      "",
      "Modules (5)",
      "  foundation, incident-core, incident-problem, incident-analytics, major-incident",
      "",
      "Activates (1)",
      "  com.snc.pa.premium   for incident-analytics",
      "",
      "Missing fields (1): the install goes on without them",
      "  incident.problem_id   (ships with com.snc.incident)",
      "    incident-problem  the problem is linked only as first reported by the incident",
      "    major-incident    the problem is linked only as first reported by the major incident",
      "  fix: repair or activate the plugin that ships each field, then pull",
      "",
      "Warnings (1)",
      "  - tested on australia only",
      "",
      "Next",
      "  have the plan reviewed, then run the same command with:",
      "    --confirm adc383e455869b0c",
    ]);
    expect(acceleratorInstall.exitCode(VIEW)).toBe(0);
  });

  it("shows a blocked plan's problems and exits 1", () => {
    const blocked = {
      ...VIEW,
      problems: [
        "plugin x (base): not on the instance",
        "field incident.u_y (base) is not on the instance. Find the plugin that ships it",
      ],
      activates: [],
      missingFields: [
        {
          field: "incident.u_y",
          from: null,
          blocking: true,
          modules: [{ module: "base", effect: null }],
        },
      ],
      notes: [],
    };
    const text = acceleratorInstall.render(blocked, "text");
    expect(text).toContain(
      "Blocked (2)\n  - plugin x (base): not on the instance\n  incident.u_y\n    base\n",
    );
    expect(text).toContain("fix the blocking problems, then plan again");
    expect(text).not.toContain("--confirm");
    expect(acceleratorInstall.exitCode(blocked)).toBe(1);
  });

  it("reports the steps it ran and where it stopped", () => {
    const step = {
      step: "module base",
      outcome: "stopped" as const,
      detail: "the instance refused 2 pa_indicators record(s) (permission denied)",
      seconds: 3.4,
    };
    const done = {
      step: "activate com.snc.pa.premium",
      outcome: "done" as const,
      detail: "active after 35 s",
      seconds: 35,
    };
    const run = {
      ...VIEW,
      reportPath: "report.md",
      steps: [done, step],
      stopped: step,
      commit: "c",
    };
    expect(acceleratorInstall.render(run, "text").split("\n")).toEqual([
      "Install adc383e455869b0c: itsm 0.8.1 on pdi3",
      "",
      "  ✓ activate com.snc.pa.premium     35 s",
      "      active after 35 s",
      "  ✗ module base                      3 s",
      "      the instance refused 2 pa_indicators record(s) (permission denied)",
      "",
      "Stopped at module base: fix it, then run the same command to resume.",
      "Report: report.md",
    ]);
    expect(acceleratorInstall.exitCode(run)).toBe(1);
    expect(acceleratorInstall.exitCode({ ...run, stopped: null })).toBe(0);
  });
});
