import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { DirectoryPackSource } from "../../src/adapters/accelerators/directory-pack-source";
import { acceleratorCheck } from "../../src/registry/accelerator-check";
import { acceleratorList } from "../../src/registry/accelerator-list";
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
});
