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

  it("shows a blocked plan's problems and exits 1", () => {
    const blocked = {
      planId: "p",
      planPath: "plan.md",
      reportPath: null,
      problems: ["plugin x (base): not on the instance"],
      warnings: ["tested on australia only"],
      modules: ["base"],
      steps: [],
      stopped: null,
      commit: null,
    };
    const text = acceleratorInstall.render(blocked, "text");
    expect(text).toContain("blocked: plugin x (base): not on the instance");
    expect(text).toContain("warning: tested on australia only");
    expect(text).toContain("fix the blocking problems, then plan again");
    expect(acceleratorInstall.exitCode(blocked)).toBe(1);
  });

  it("reports the steps it ran and where it stopped", () => {
    const step = {
      step: "module base",
      outcome: "stopped" as const,
      detail: "1 not applied",
      seconds: 3,
    };
    const text = acceleratorInstall.render(
      {
        planId: "p",
        planPath: "plan.md",
        reportPath: "report.md",
        problems: [],
        warnings: [],
        modules: ["base"],
        steps: [step],
        stopped: step,
        commit: "c",
      },
      "text",
    );
    expect(text).toContain("stopped  module base  1 not applied  (3 s)");
    expect(text).toContain("stopped at module base");
    expect(
      acceleratorInstall.exitCode({
        planId: "p",
        planPath: "",
        reportPath: "r",
        problems: [],
        warnings: [],
        modules: [],
        steps: [],
        stopped: null,
        commit: "c",
      }),
    ).toBe(0);
  });
});
