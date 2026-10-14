import { describe, expect, it } from "bun:test";
import {
  addPack,
  type InventoryReader,
  type MaterializedFile,
  PackNotAddableError,
  type PackSource,
  type PackWorkspace,
} from "@snagentic/core";

const SLA = "3d5fd9f1c0a8016400cbc76ea0b4c9a4";

const MINIMAL = {
  id: "minimal",
  version: "1.0.0",
  requires: { snagentic: ">=1.8.0" },
  scope: "x_snagentic_min",
  capabilities: {
    base: { wave: 0, label: "base" },
    extra: {
      wave: 1,
      label: "extra",
      dependsOn: ["base"],
      plugins: [{ id: "com.snc.on_call_rotation", entitlement: "free" }],
    },
  },
};

const FILES = new Map([
  ["accelerator.yaml", "id: minimal"],
  ["metadata/base/x_snagentic_min/sys_app/min--a1.yaml", "name: min\n"],
  ["patches/base/sla.yaml", `PATCH ${SLA}`],
  ["metadata/extra/global/sys_script/rule--a3.yaml", "name: rule\n"],
]);

const packs: PackSource = {
  ids: async () => ["minimal"],
  manifest: async (id) => (id === "minimal" ? MINIMAL : null),
  files: async () => FILES,
};

const inventory = (onCall: "active" | "inactive"): InventoryReader => ({
  read: async (_r, _i, file) =>
    file === "plugins"
      ? [{ id: "com.snc.on_call_rotation", active: onCall, version: "1.0.0" }]
      : null,
});

function fakeWorkspace(
  state: { mirror?: string | null; integrated?: boolean; conflicts?: string[] } = {},
) {
  const calls: {
    committed?: readonly MaterializedFile[];
    message?: string;
    asked?: readonly string[];
  } = {};
  const workspace: PackWorkspace = {
    mirrorCommit: async () => (state.mirror === undefined ? "m1" : state.mirror),
    includes: async () => state.integrated ?? true,
    mirrored: async (_commit, sysIds) => {
      calls.asked = sysIds;
      return new Map(
        sysIds
          .filter((id) => id === SLA)
          .map((id) => [
            id,
            { path: `global/contract_sla/p1--${id}.yaml`, document: { _meta: {}, duration: "8h" } },
          ]),
      );
    },
    parse: (text) =>
      text.startsWith("PATCH ")
        ? { table: "contract_sla", sys_id: text.slice(6), fields: { duration: "4h" } }
        : {},
    commit: async (_pack, _mirror, files, message) => {
      calls.committed = files;
      calls.message = message;
      return "c1";
    },
    merge: async (pack) => ({
      branch: `accelerator/${pack}/pdi2`,
      conflicts: state.conflicts ?? [],
    }),
  };
  return { workspace, calls };
}

const QUERY = { pack: "minimal", instance: { root: "/w", name: "pdi2" }, snagentic: "1.8.0" };

describe("accelerator add (ADR-0026)", () => {
  it("commits the selection's files to the pack branch and merges it", async () => {
    const { workspace, calls } = fakeWorkspace();
    const result = await addPack({ packs, inventory: inventory("active"), workspace }, QUERY);
    expect(result).toEqual({
      pack: "minimal",
      version: "1.0.0",
      selected: ["base", "extra"],
      branch: "accelerator/minimal/pdi2",
      commit: "c1",
      copied: 2,
      patched: 1,
      conflicts: [],
    });
    // The records it creates (they may exist from an earlier add) and the patch target.
    expect(calls.asked).toEqual(["a1", SLA, "a3"]);
    expect(calls.message).toBe("snagentic accelerator add minimal 1.0.0: base, extra");
    expect(calls.committed?.find((f) => f.kind === "patch")).toMatchObject({
      path: `global/contract_sla/p1--${SLA}.yaml`,
      document: { duration: "4h" },
    });
  });

  it("reports the files the merge left in conflict with the user's edits", async () => {
    const { workspace } = fakeWorkspace({ conflicts: ["instances/pdi2/metadata/x.yaml"] });
    const result = await addPack({ packs, inventory: inventory("active"), workspace }, QUERY);
    expect(result.conflicts).toEqual(["instances/pdi2/metadata/x.yaml"]);
  });

  it("refuses a selection that is not ready, naming why, and writes nothing", async () => {
    const { workspace, calls } = fakeWorkspace();
    const add = addPack(
      { packs, inventory: inventory("inactive"), workspace },
      {
        ...QUERY,
        capabilities: ["extra", "nope"],
      },
    );
    await expect(add).rejects.toThrow(PackNotAddableError);
    await expect(add).rejects.toThrow("the pack has no capability nope; extra is needs-plugins");
    expect(calls.committed).toBeUndefined();
  });

  it("refuses before the first pull, and while the latest pull is not integrated", async () => {
    const never = fakeWorkspace({ mirror: null }).workspace;
    await expect(
      addPack({ packs, inventory: inventory("active"), workspace: never }, QUERY),
    ).rejects.toThrow("pull pdi2 first");
    const behind = fakeWorkspace({ integrated: false }).workspace;
    await expect(
      addPack({ packs, inventory: inventory("active"), workspace: behind }, QUERY),
    ).rejects.toThrow("integrate pdi2 first");
  });

  it("refuses a patch whose record the mirror does not have", async () => {
    const { workspace } = fakeWorkspace();
    const other = { ...workspace, mirrored: async () => new Map() };
    await expect(
      addPack({ packs, inventory: inventory("active"), workspace: other }, QUERY),
    ).rejects.toThrow(`contract_sla ${SLA} is not in the mirror`);
  });
});
