import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { InstallPlanChangedError } from "@snagentic/core";
import { CsvDataTemplates } from "../../src/adapters/accelerators/csv-data-templates";
import { DirectoryPackSource } from "../../src/adapters/accelerators/directory-pack-source";
import { acceleratorInstall } from "../../src/registry/accelerator-install";
import { executeUseCase } from "../../src/registry/execute";
import { instanceWorkspace } from "../support/instance-workspace";

const PACKS = new DirectoryPackSource([
  resolve(import.meta.dir, "../../../../tests/fixtures/accelerators"),
]);

async function installing() {
  const { context } = await instanceWorkspace({});
  const written: string[] = [];
  return {
    written,
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
