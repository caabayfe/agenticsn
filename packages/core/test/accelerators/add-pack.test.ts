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

const ADOPT = JSON.stringify([{ table: "contract_sla", sys_id: SLA, note: "set duration to 4h" }]);
const FILES = new Map([
  ["accelerator.yaml", "id: minimal"],
  ["source/base/x_snagentic_min/src/fluent/app.now.ts", "Record({})\n"],
  ["adopt/base.yaml", ADOPT],
  ["source/extra/global/src/fluent/rule.now.ts", "BusinessRule({})\n"],
]);

const packs = (files: ReadonlyMap<string, string> = FILES): PackSource => ({
  ids: async () => ["minimal"],
  manifest: async (id) => (id === "minimal" ? MINIMAL : null),
  files: async () => files,
});

const inventory = (onCall: "active" | "inactive"): InventoryReader => ({
  read: async (_r, _i, file) =>
    file === "plugins"
      ? [{ id: "com.snc.on_call_rotation", active: onCall, version: "1.0.0" }]
      : null,
});

function fakeWorkspace(
  state: {
    mirror?: string | null;
    integrated?: boolean;
    conflicts?: string[];
    previous?: { written: string[]; kept: string[] };
  } = {},
) {
  const calls: {
    committed?: readonly MaterializedFile[];
    kept?: readonly string[];
    message?: string;
  } = {};
  const workspace: PackWorkspace = {
    mirrorCommit: async () => (state.mirror === undefined ? "m1" : state.mirror),
    includes: async () => state.integrated ?? true,
    parse: (text) => JSON.parse(text),
    previous: async () => state.previous ?? { written: [], kept: [] },
    commit: async (_pack, _mirror, files, message, keep) => {
      calls.committed = files;
      calls.kept = keep;
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

describe("accelerator add (ADR-0026, ADR-0031)", () => {
  it("commits the selection's Fluent source to the pack branch, merges it, and lists what to adopt", async () => {
    const { workspace, calls } = fakeWorkspace();
    const result = await addPack(
      { packs: packs(), inventory: inventory("active"), workspace },
      QUERY,
    );
    expect(result).toEqual({
      pack: "minimal",
      instance: "pdi2",
      version: "1.0.0",
      selected: ["base", "extra"],
      branch: "accelerator/minimal/pdi2",
      commit: "c1",
      copied: [
        "source/x_snagentic_min/src/fluent/app.now.ts",
        "source/global/src/fluent/rule.now.ts",
      ],
      adoptions: [
        { capability: "base", table: "contract_sla", sysId: SLA, note: "set duration to 4h" },
      ],
      removed: [],
      conflicts: [],
    });
    expect(calls.kept).toEqual([]);
    expect(calls.message).toBe("snagentic accelerator add minimal 1.0.0: base, extra");
    expect(calls.committed?.[0]).toEqual({
      path: "source/x_snagentic_min/src/fluent/app.now.ts",
      text: "Record({})\n",
      capability: "base",
    });
  });

  it("keeps a file the last add wrote and this version dropped, and reports it (M8)", async () => {
    const dropped = "source/x_snagentic_min/src/fluent/old.now.ts";
    const { workspace, calls } = fakeWorkspace({
      previous: { written: ["source/x_snagentic_min/src/fluent/app.now.ts", dropped], kept: [] },
    });
    const result = await addPack(
      { packs: packs(), inventory: inventory("active"), workspace },
      QUERY,
    );
    expect(result.removed).toEqual([dropped]);
    expect(calls.kept).toEqual([dropped]);
  });

  it("reports the files the merge left in conflict with the user's edits", async () => {
    const { workspace } = fakeWorkspace({ conflicts: ["source/global/src/fluent/rule.now.ts"] });
    const result = await addPack(
      { packs: packs(), inventory: inventory("active"), workspace },
      QUERY,
    );
    expect(result.conflicts).toEqual(["source/global/src/fluent/rule.now.ts"]);
  });

  it("refuses a selection that is not ready, naming why, and writes nothing", async () => {
    const { workspace, calls } = fakeWorkspace();
    const add = addPack(
      { packs: packs(), inventory: inventory("inactive"), workspace },
      { ...QUERY, capabilities: ["extra", "nope"] },
    );
    await expect(add).rejects.toThrow(PackNotAddableError);
    await expect(add).rejects.toThrow("the pack has no capability nope; extra is needs-plugins");
    expect(calls.committed).toBeUndefined();
  });

  it("refuses before the first pull, and while the latest pull is not integrated", async () => {
    const never = fakeWorkspace({ mirror: null }).workspace;
    await expect(
      addPack({ packs: packs(), inventory: inventory("active"), workspace: never }, QUERY),
    ).rejects.toThrow("pull pdi2 first");
    const behind = fakeWorkspace({ integrated: false }).workspace;
    await expect(
      addPack({ packs: packs(), inventory: inventory("active"), workspace: behind }, QUERY),
    ).rejects.toThrow("integrate pdi2 first");
  });

  it("refuses a pack still in format 1, and writes nothing", async () => {
    const { workspace, calls } = fakeWorkspace();
    const old = new Map([...FILES, ["patches/base/sla.yaml", "table: contract_sla"]]);
    await expect(
      addPack({ packs: packs(old), inventory: inventory("active"), workspace }, QUERY),
    ).rejects.toThrow("patches/base/sla.yaml: pack format 1");
    expect(calls.committed).toBeUndefined();
  });
});
