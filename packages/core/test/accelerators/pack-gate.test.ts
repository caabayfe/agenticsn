import { describe, expect, it } from "bun:test";
import {
  computePlan,
  type InventoryReader,
  type PackSource,
  type PackWorkspace,
  packFindings,
} from "@snagentic/core";
import { RULE, setup } from "../support/delivery-fixture";

const SLA = "3d5fd9f1c0a8016400cbc76ea0b4c9a4";
const MINIMAL = {
  id: "minimal",
  version: "1.0.0",
  requires: { snagentic: ">=1.6.0" },
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
const packs: PackSource = {
  ids: async () => ["minimal"],
  manifest: async () => MINIMAL,
  files: async () =>
    new Map([
      ["accelerator.yaml", ""],
      ["metadata/base/x_snagentic_min/sys_app/min--a1.yaml", "name: min"],
      ["metadata/extra/global/sys_script/rule--a3.yaml", "name: rule"],
      ["patches/extra/sla.yaml", `PATCH ${SLA}`],
    ]),
};
const inventory = (state: "active" | "inactive"): InventoryReader => ({
  read: async (_r, _i, file) =>
    file === "plugins"
      ? [{ id: "com.snc.on_call_rotation", active: state, version: "1.0.0" }]
      : null,
});
const workspace: PackWorkspace = {
  mirrorCommit: async () => "m1",
  includes: async () => true,
  mirrored: async (_c, ids) =>
    new Map(ids.map((id) => [id, { path: `global/contract_sla/p1--${id}.yaml`, document: {} }])),
  parse: (text) => (text.startsWith("PATCH ") ? { sys_id: text.slice(6) } : {}),
  commit: async () => "c",
  merge: async () => ({ branch: "b", conflicts: [] }),
};
const QUERY = { instance: { root: "/w", name: "pdi2" }, snagentic: "1.6.0" };

describe("the gate's accelerator check (SN-MNT-012, ADR-0026)", () => {
  it("blocks a planned file of a capability whose plugin is inactive, with the commands that fix it", async () => {
    const findings = await packFindings(
      { packs, inventory: inventory("inactive"), workspace },
      { ...QUERY, paths: ["global/sys_script/rule--a3.yaml", "global/sys_script/other--b1.yaml"] },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-012",
        severity: "block",
        path: "global/sys_script/rule--a3.yaml",
        message: "capability extra of minimal is needs-plugins: com.snc.on_call_rotation",
        remediation:
          "snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm; then snagentic pull pdi2; then plan again",
      }),
    ]);
  });

  it("finds a patched out-of-box record through its sys_id in the mirror", async () => {
    const findings = await packFindings(
      { packs, inventory: inventory("inactive"), workspace },
      { ...QUERY, paths: [`global/contract_sla/p1--${SLA}.yaml`] },
    );
    expect(findings.map((f) => f.path)).toEqual([`global/contract_sla/p1--${SLA}.yaml`]);
  });

  it("passes once the inventory shows the plugin active, and for files no pack added", async () => {
    const paths = ["global/sys_script/rule--a3.yaml", "x_snagentic_min/sys_app/min--a1.yaml"];
    expect(
      await packFindings({ packs, inventory: inventory("active"), workspace }, { ...QUERY, paths }),
    ).toEqual([]);
    expect(
      await packFindings(
        { packs, inventory: inventory("inactive"), workspace },
        { ...QUERY, paths: [] },
      ),
    ).toEqual([]);
  });

  it("makes plan not ready: the finding blocks the gate like any other", async () => {
    const { deps } = setup();
    const finding = {
      ruleId: "SN-MNT-012",
      severity: "block" as const,
      title: "t",
      path: `${RULE}.yaml`,
      field: null,
      line: null,
      message: "capability extra of minimal is needs-plugins",
      evidence: "",
      why: "",
      remediation: "",
    };
    const seen: string[][] = [];
    const gated = {
      ...deps,
      packGate: async (paths: readonly string[]) => {
        seen.push([...paths]);
        return [finding];
      },
    };
    const { plan } = await computePlan(gated, { instance: "dev", allowCollisions: false });
    expect(seen).toEqual([[`${RULE}.yaml`]]);
    expect(plan.ready).toBe(false);
    expect(plan.gate.blocking).toEqual([expect.objectContaining({ ruleId: "SN-MNT-012" })]);
  });
});
