import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DataSourceRequiredError } from "@snagentic/core";
import { parse } from "yaml";
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
      modules: [],
      packs: [
        {
          id: "minimal",
          modules: [
            { id: "base", label: "snagentic test pack: base" },
            { id: "extra", label: "snagentic test pack: extra" },
          ],
          profiles: { core: ["base"], all: ["base", "extra"] },
        },
      ],
    });
    const text = acceleratorCheck.render(output as never, "text");
    expect(text).toContain("installs base, extra");
    expect(text).toContain("data to load, in order: location");
  });

  it("selects a profile's modules, and reports a profile the pack does not have", async () => {
    const core = await executeUseCase(
      acceleratorCheck,
      { pack: "minimal", profile: "core" },
      context,
    );
    expect(core.output).toMatchObject({ selected: ["base"], unknown: [] });
    const named = await executeUseCase(
      acceleratorCheck,
      { pack: "minimal", modules: ["extra"] },
      context,
    );
    expect(named.output).toMatchObject({ selected: ["base", "extra"] });
    const full = await executeUseCase(
      acceleratorCheck,
      { pack: "minimal", profile: "full" },
      context,
    );
    expect(full.output).toMatchObject({ selected: [], unknown: ["profile full"] });
    expect(acceleratorCheck.exitCode(full.output as never)).toBe(1);
  });

  it("exits 1 while a module is not ready", () => {
    const module = {
      id: "extra",
      state: "needs-components" as const,
      components: [
        {
          kind: "plugin" as const,
          id: "com.snc.on_call_rotation",
          state: "inactive" as const,
          version: "1.0.0",
          minVersion: null,
          entitlement: "free" as const,
        },
      ],
      next: [
        "snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm",
        "snagentic pull pdi2",
      ],
    };
    const output = {
      packs: [{ id: "minimal", version: "1.0.0", modules: [], profiles: {} }],
      selected: ["base", "extra"],
      unknown: ["nope"],
      data: [],
      problems: ["the pack needs snagentic >=9.0.0"],
      warnings: ["the pack was tested on zurich; this instance runs yokohama"],
      modules: [module],
    };
    const text = acceleratorCheck.render(output, "text");
    expect(text).toContain("needs-components extra");
    expect(text).toContain("  plugin com.snc.on_call_rotation: inactive");
    expect(text).toContain(
      "next: snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm",
    );
    expect(text).toContain("unknown: nope");
    expect(text).toContain("warning: the pack was tested on zurich");
    expect(acceleratorCheck.exitCode(output)).toBe(1);
    expect(acceleratorCheck.exitCode({ ...output, unknown: [], problems: [], modules: [] })).toBe(
      0,
    );
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
      present: async () => [],
      parse: (text: string): unknown => parse(text),
      previous: async () => ({ written: [], kept: [] }),
      commit: async () => "c1",
      merge: async () => ({ branch: "accelerator/minimal/pdi2", conflicts: [] }),
    };
    const workspaces = {
      ...context.workspaces,
      readManifest: async () => ({ layout: 2, createdWith: "test" }),
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
    expect(output).toMatchObject({
      selected: ["base", "extra"],
      commit: "c1",
      copied: [
        "source/global/src/fluent/app.now.ts",
        "source/global/src/fluent/generated/keys.ts",
        "source/x_snagentic_min/now.config.json",
        "source/x_snagentic_min/package.json",
        "source/x_snagentic_min/src/fluent/generated/keys.ts",
        "source/x_snagentic_min/src/fluent/properties.now.ts",
      ],
      adoptions: [
        {
          capability: "base",
          table: "sys_app",
          sysId: "489da54ae67c4a3e9f1e1e4347e9119b",
          note: "set short_description to 'Spike S11 scratch application (described by the minimal test pack)'",
        },
      ],
      conflicts: [],
    });
    const text = acceleratorAdd.render(output as never, "text");
    expect(text).toContain("added minimal 1.0.0 (base, extra): 6 file(s)");
    expect(text).toContain("  source/x_snagentic_min/src/fluent/properties.now.ts");
    expect(text).toContain(
      "next (base): snagentic adopt --instance pdi2 sys_app:489da54ae67c4a3e9f1e1e4347e9119b, then set short_description to",
    );
    expect(text).toContain("next: snagentic validate");
    const conflicted = { ...(output as never as Record<string, unknown>), conflicts: ["a.yaml"] };
    expect(acceleratorAdd.render(conflicted as never, "text")).toContain("conflict: a.yaml");
    expect(acceleratorAdd.exitCode(conflicted as never)).toBe(1);
    const upgraded = {
      ...(output as never as Record<string, unknown>),
      removed: ["x/old--a9.yaml"],
    };
    expect(acceleratorAdd.render(upgraded as never, "text")).toContain(
      "no longer in the pack, kept: x/old--a9.yaml (snagentic never deletes; remove it yourself)",
    );
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

  it("validates the pack's demo data with --demo, and needs exactly one data source", async () => {
    const validating = { ...context, dataTemplates: new CsvDataTemplates() };
    const { output } = await executeUseCase(
      acceleratorValidateData,
      { pack: "minimal", demo: true },
      validating,
    );
    expect(output).toMatchObject({
      passed: true,
      entities: [{ entity: "location", rows: 2, problems: [] }],
    });
    await expect(
      executeUseCase(acceleratorValidateData, { pack: "minimal" }, validating),
    ).rejects.toThrow(DataSourceRequiredError);
    await expect(
      executeUseCase(
        acceleratorValidateData,
        { pack: "minimal", demo: true, data: "/d" },
        validating,
      ),
    ).rejects.toThrow(DataSourceRequiredError);
  });
});
