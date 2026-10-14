import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CsvDataTemplates } from "../../src/adapters/accelerators/csv-data-templates";
import { DirectoryPackSource } from "../../src/adapters/accelerators/directory-pack-source";
import { acceleratorAdd } from "../../src/registry/accelerator-add";
import { acceleratorCheck } from "../../src/registry/accelerator-check";
import { acceleratorList } from "../../src/registry/accelerator-list";
import { acceleratorValidateData } from "../../src/registry/accelerator-validate-data";
import { executeUseCase } from "../../src/registry/execute";
import { FAKE_CONTEXT } from "../support/fakes";

const packs = new DirectoryPackSource([
  resolve(import.meta.dir, "../../../../tests/fixtures/accelerators"),
]);
const inventory = {
  read: async (_root: string, _instance: string, file: string) =>
    file === "plugins"
      ? [
          {
            id: "com.snc.on_call_rotation",
            active: "inactive",
            version: "1.0.0",
            name: "",
            scope: "",
          },
        ]
      : null,
};
const context = {
  ...FAKE_CONTEXT,
  packs,
  inventory,
  cwd: () => resolve(import.meta.dir, "../../../../tests/fixtures/accelerators"),
};

describe("accelerator use cases", () => {
  it("lists the packs, and the tool lists them without a pack", async () => {
    const list = await executeUseCase(acceleratorList, {}, context);
    expect(acceleratorList.render(list.output as never, "text")).toContain("minimal 1.0.0");
    const tool = await executeUseCase(acceleratorCheck, {}, context);
    expect(tool.output).toMatchObject({ packs: [{ id: "minimal" }], selected: [] });
    expect(acceleratorCheck.render(tool.output as never, "text")).toBe("minimal 1.0.0");
  });

  it("shows what a pack installs, and the commands that make it installable", async () => {
    const { output } = await executeUseCase(acceleratorCheck, { pack: "minimal" }, context);
    expect(output).toMatchObject({
      selected: ["base", "extra"],
      data: ["location"],
      capabilities: [],
    });
    const text = acceleratorCheck.render(output as never, "text");
    expect(text).toContain("installs base, extra");
    expect(text).toContain("data to load, in order: location");
  });

  it("exits 1 while a capability is not ready", () => {
    const capability = {
      id: "extra",
      wave: 1,
      state: "needs-plugins" as const,
      plugins: [
        {
          id: "com.snc.on_call_rotation",
          state: "inactive" as const,
          version: "1.0.0",
          minVersion: null,
        },
      ],
      next: [
        "snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm",
        "snagentic pull pdi2",
      ],
    };
    const output = {
      packs: [{ id: "minimal", version: "1.0.0", scope: "x", capabilities: [] }],
      selected: ["base", "extra"],
      unknown: ["nope"],
      data: [],
      problems: ["the pack needs snagentic >=9.0.0"],
      capabilities: [capability],
    };
    const text = acceleratorCheck.render(output, "text");
    expect(text).toContain("needs-plugins extra (wave 1)");
    expect(text).toContain(
      "next: snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm",
    );
    expect(text).toContain("unknown capability: nope");
    expect(acceleratorCheck.exitCode(output)).toBe(1);
    expect(
      acceleratorCheck.exitCode({ ...output, unknown: [], problems: [], capabilities: [] }),
    ).toBe(0);
  });

  it("says when there are no packs", async () => {
    const none = { ...context, packs: new DirectoryPackSource([]) };
    const list = await executeUseCase(acceleratorList, {}, none);
    expect(acceleratorList.render(list.output as never, "text")).toBe("no accelerator packs");
  });

  it("adds a pack through the pack workspace, and points to validate next", async () => {
    const inventoryActive = {
      read: async (_r: string, _i: string, file: string) =>
        file === "plugins"
          ? [
              {
                id: "com.snc.on_call_rotation",
                active: "active",
                version: "1.0.0",
                name: "",
                scope: "",
              },
            ]
          : null,
    };
    const workspace = {
      mirrorCommit: async () => "m1",
      includes: async () => true,
      mirrored: async () => new Map(),
      parse: () => ({}),
      commit: async () => "c1",
      merge: async () => ({ branch: "accelerator/minimal/pdi2", conflicts: [] }),
    };
    const workspaces = {
      ...context.workspaces,
      readManifest: async () => ({ layout: 1, createdWith: "test" }),
    };
    const adding = {
      ...context,
      workspaces,
      inventory: inventoryActive,
      packWorkspace: () => workspace,
    };
    const { output } = await executeUseCase(
      acceleratorAdd,
      { pack: "minimal", instance: "pdi2" },
      adding,
    );
    expect(output).toMatchObject({ selected: ["base", "extra"], commit: "c1", conflicts: [] });
    const text = acceleratorAdd.render(output as never, "text");
    expect(text).toContain("added minimal 1.0.0 (base, extra)");
    expect(text).toContain("next: snagentic validate");
    const conflicted = { ...(output as never as Record<string, unknown>), conflicts: ["a.yaml"] };
    expect(acceleratorAdd.render(conflicted as never, "text")).toContain("conflict: a.yaml");
    expect(acceleratorAdd.exitCode(conflicted as never)).toBe(1);
    expect(acceleratorAdd.exitCode(output as never)).toBe(0);
  });

  it("validates a data directory's templates and names each problem", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pack-data-"));
    writeFileSync(join(dir, "location.csv"), "name,city\nSydney HQ,Sydney\nMelbourne,\n");
    const validating = { ...context, dataTemplates: new CsvDataTemplates() };
    const { output } = await executeUseCase(
      acceleratorValidateData,
      { pack: "minimal", data: dir },
      validating,
    );
    expect(output).toMatchObject({
      passed: false,
      entities: [
        { entity: "location", rows: 2, problems: ["row 2 (Melbourne): city is mandatory"] },
      ],
    });
    const text = acceleratorValidateData.render(output as never, "text");
    expect(text).toContain("invalid location: 2 row(s)");
    expect(text).toContain("fix the templates");
    expect(acceleratorValidateData.exitCode(output as never)).toBe(1);
    const fine = { ...(output as never as Record<string, unknown>), passed: true, entities: [] };
    expect(acceleratorValidateData.render(fine as never, "text")).toContain("ready to load");
    expect(acceleratorValidateData.exitCode(fine as never)).toBe(0);
  });
});
