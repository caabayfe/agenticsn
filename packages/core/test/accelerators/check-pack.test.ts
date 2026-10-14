import { describe, expect, it } from "bun:test";
import {
  checkPack,
  InvalidPackError,
  type InventoryReader,
  listPacks,
  PackNotFoundError,
  type PackSource,
} from "@snagentic/core";

const MINIMAL = {
  id: "minimal",
  version: "1.0.0",
  requires: { snagentic: ">=1.8.0" },
  scope: "x_snagentic_min",
  capabilities: {
    base: {
      wave: 0,
      label: "base",
      data: [{ entity: "location", table: "imp_location", key: ["name"], after: [] }],
    },
    extra: {
      wave: 1,
      label: "extra",
      dependsOn: ["base"],
      plugins: [{ id: "com.snc.on_call_rotation", entitlement: "free" }],
    },
  },
};

const packs = (documents: Record<string, unknown>): PackSource => ({
  ids: async () => Object.keys(documents).sort(),
  manifest: async (id) => documents[id] ?? null,
});

const inventory = (rows: Record<string, string>[] | null): InventoryReader => ({
  read: async (_root, _instance, file) => (file === "plugins" ? rows : null),
});

const deps = (rows: Record<string, string>[] | null = []) => ({
  packs: packs({ minimal: MINIMAL }),
  inventory: inventory(rows),
});

describe("accelerator list and check", () => {
  it("lists the packs with their capabilities and waves", async () => {
    expect(await listPacks(packs({ minimal: MINIMAL }))).toEqual([
      {
        id: "minimal",
        version: "1.0.0",
        scope: "x_snagentic_min",
        capabilities: [
          { id: "base", wave: 0, label: "base" },
          { id: "extra", wave: 1, label: "extra" },
        ],
      },
    ]);
  });

  it("shows what a selection installs, without an instance", async () => {
    expect(
      await checkPack(deps(), { pack: "minimal", waves: [1], snagentic: "1.8.0" }),
    ).toMatchObject({
      selected: ["base", "extra"],
      unknown: [],
      data: ["location"],
      report: null,
    });
  });

  it("checks the selection against the instance's mirrored plugins", async () => {
    const rows = [{ id: "com.snc.on_call_rotation", active: "inactive", version: "1.2.0" }];
    const result = await checkPack(deps(rows), {
      pack: "minimal",
      instance: { root: "/w", name: "pdi2" },
      snagentic: "1.8.0",
    });
    expect(result.report?.capabilities.map((c) => [c.id, c.state])).toEqual([
      ["base", "ready"],
      ["extra", "needs-plugins"],
    ]);
  });

  it("has no report before the instance's first pull", async () => {
    const result = await checkPack(deps(null), {
      pack: "minimal",
      instance: { root: "/w", name: "pdi2" },
      snagentic: "1.8.0",
    });
    expect(result.report).toBeNull();
  });

  it("names the packs it has when asked for one it does not have", async () => {
    await expect(checkPack(deps(), { pack: "itsm", snagentic: "1.8.0" })).rejects.toThrow(
      PackNotFoundError,
    );
    await expect(
      checkPack({ ...deps(), packs: packs({}) }, { pack: "itsm", snagentic: "1.8.0" }),
    ).rejects.toThrow("no accelerator pack itsm");
  });

  it("refuses a pack whose manifest is not valid", async () => {
    const broken = { ...deps(), packs: packs({ minimal: { ...MINIMAL, version: "x" } }) };
    await expect(checkPack(broken, { pack: "minimal", snagentic: "1.8.0" })).rejects.toThrow(
      InvalidPackError,
    );
  });
});
