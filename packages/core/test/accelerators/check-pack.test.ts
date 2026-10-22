import { describe, expect, it } from "bun:test";
import {
  checkPack,
  InvalidPackError,
  type InventoryReader,
  listPacks,
  PackNotFoundError,
} from "@snagentic/core";
import { memoryPacks, type PackFixture, packFiles } from "../support/memory-packs";

const MINIMAL: PackFixture = {
  pack: {
    id: "minimal",
    version: "1.0.0",
    requires: { snagentic: ">=1.8.0" },
    profiles: { core: ["base"] },
  },
  modules: {
    base: {
      label: "base",
      data: [{ entity: "location", table: "imp_location", key: ["name"], after: [] }],
    },
    extra: {
      label: "extra",
      dependsOn: ["base"],
      components: [{ kind: "plugin", id: "com.snc.on_call_rotation", entitlement: "free" }],
    },
  },
};

const inventory = (rows: Record<string, string>[] | null): InventoryReader => ({
  read: async (_root, _instance, file) => (file === "plugins" ? rows : null),
});

const deps = (rows: Record<string, string>[] | null = []) => ({
  packs: memoryPacks({ minimal: packFiles(MINIMAL) }),
  inventory: inventory(rows),
});

describe("accelerator list and check", () => {
  it("checks a store application against the store application inventory, by scope", async () => {
    const withApp: PackFixture = {
      ...MINIMAL,
      modules: {
        base: {
          label: "base",
          components: [{ kind: "app", id: "sn_ex_sp", minVersion: "39.0.0", entitlement: "free" }],
        },
      },
    };
    const read = (apps: Record<string, string>[]): InventoryReader => ({
      read: async (_root, _instance, file) => (file === "store_apps" ? apps : []),
    });
    const check = async (apps: Record<string, string>[]) =>
      (
        await checkPack(
          { packs: memoryPacks({ minimal: packFiles(withApp) }), inventory: read(apps) },
          {
            pack: "minimal",
            instance: { root: "/w", name: "pdi2" },
            snagentic: "2.2.0",
          },
        )
      ).report?.capabilities[0];
    const app = { scope: "sn_ex_sp", version: "39.0.12", active: "true" };
    expect((await check([app]))?.state).toBe("ready");
    expect((await check([{ ...app, active: "false" }]))?.components[0]?.state).toBe("inactive");
    expect((await check([]))?.components[0]).toMatchObject({ kind: "app", state: "missing" });
  });

  it("lists the packs with their modules and profiles", async () => {
    expect(await listPacks(memoryPacks({ minimal: packFiles(MINIMAL) }))).toEqual([
      {
        id: "minimal",
        version: "1.0.0",
        modules: [
          { id: "base", label: "base" },
          { id: "extra", label: "extra" },
        ],
        profiles: { core: ["base"] },
      },
    ]);
  });

  it("shows what a selection installs, without an instance", async () => {
    expect(
      await checkPack(deps(), { pack: "minimal", modules: ["extra"], snagentic: "1.8.0" }),
    ).toMatchObject({
      selected: ["base", "extra"],
      unknown: [],
      data: ["location"],
      report: null,
    });
  });

  it("selects a profile's modules, and reports a profile the pack does not have", async () => {
    expect(
      await checkPack(deps(), { pack: "minimal", profile: "core", snagentic: "1.8.0" }),
    ).toMatchObject({ selected: ["base"], unknown: [] });
    expect(
      await checkPack(deps(), { pack: "minimal", profile: "full", snagentic: "1.8.0" }),
    ).toMatchObject({ selected: [], unknown: ["profile full"] });
  });

  it("checks the selection against the instance's mirrored components", async () => {
    const rows = [{ id: "com.snc.on_call_rotation", active: "inactive", version: "1.2.0" }];
    const result = await checkPack(deps(rows), {
      pack: "minimal",
      instance: { root: "/w", name: "pdi2" },
      snagentic: "1.8.0",
    });
    expect(result.report?.capabilities.map((c) => [c.id, c.state])).toEqual([
      ["base", "ready"],
      ["extra", "needs-components"],
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
      checkPack({ ...deps(), packs: memoryPacks({}) }, { pack: "itsm", snagentic: "1.8.0" }),
    ).rejects.toThrow("no accelerator pack itsm");
  });

  it("refuses a pack whose manifest is not valid", async () => {
    const invalid = packFiles({ ...MINIMAL, pack: { ...MINIMAL.pack, version: "x" } });
    const broken = { ...deps(), packs: memoryPacks({ minimal: invalid }) };
    await expect(checkPack(broken, { pack: "minimal", snagentic: "1.8.0" })).rejects.toThrow(
      InvalidPackError,
    );
  });

  it("refuses a pack still in format 1, naming the new layout", async () => {
    const old = new Map([
      ["accelerator.yaml", JSON.stringify({ ...MINIMAL.pack, capabilities: MINIMAL.modules })],
    ]);
    const broken = { ...deps(), packs: memoryPacks({ minimal: old }) };
    await expect(checkPack(broken, { pack: "minimal", snagentic: "1.8.0" })).rejects.toThrow(
      "pack format 1",
    );
  });
});
