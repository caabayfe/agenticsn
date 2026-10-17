import { describe, expect, it } from "bun:test";
import {
  computeUnitPlan,
  type InventoryReader,
  type PackSource,
  packFindings,
} from "@snagentic/core";
import { unitSetup } from "../delivery/unit-fixture";

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
      ["source/base/x_snagentic_min/src/fluent/app.now.ts", "Record({})"],
      ["source/extra/global/src/fluent/rule.now.ts", "BusinessRule({})"],
      ["source/extra/x_snagentic_min/now.config.json", "{}"],
      ["adopt/extra.yaml", "[]"],
    ]),
};
const inventory = (state: "active" | "inactive"): InventoryReader => ({
  read: async (_r, _i, file) =>
    file === "plugins"
      ? [{ id: "com.snc.on_call_rotation", active: state, version: "1.0.0" }]
      : null,
});
const QUERY = { instance: { root: "/w", name: "pdi2" }, snagentic: "1.6.0" };

describe("the gate's accelerator check (SN-MNT-012, ADR-0026, ADR-0031)", () => {
  it("blocks a planned project a capability ships into while it is not ready, with the commands that fix it", async () => {
    const findings = await packFindings(
      { packs, inventory: inventory("inactive") },
      { ...QUERY, paths: ["source/global", "source/x_other"] },
    );
    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: "SN-MNT-012",
        severity: "block",
        path: "source/global",
        root: "workspace",
        message: "capability extra of minimal is needs-plugins: com.snc.on_call_rotation",
        remediation:
          "snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm; then snagentic pull pdi2; then plan again",
      }),
    ]);
  });

  it("names only the capabilities that are not ready, when several ship into one project", async () => {
    const findings = await packFindings(
      { packs, inventory: inventory("inactive") },
      { ...QUERY, paths: ["source/x_snagentic_min"] },
    );
    expect(findings.map((f) => [f.path, f.message])).toEqual([
      [
        "source/x_snagentic_min",
        "capability extra of minimal is needs-plugins: com.snc.on_call_rotation",
      ],
    ]);
  });

  it("passes once the inventory shows the plugin active, for projects no pack ships into, and with nothing planned", async () => {
    const paths = ["source/global", "source/x_snagentic_min"];
    expect(
      await packFindings({ packs, inventory: inventory("active") }, { ...QUERY, paths }),
    ).toEqual([]);
    expect(
      await packFindings(
        { packs, inventory: inventory("inactive") },
        { ...QUERY, paths: ["source/x_other"] },
      ),
    ).toEqual([]);
    expect(
      await packFindings({ packs, inventory: inventory("inactive") }, { ...QUERY, paths: [] }),
    ).toEqual([]);
  });

  it("makes plan not ready: the finding blocks the gate like any other", async () => {
    const { deps } = unitSetup({ source: "Edited in source." });
    const finding = {
      ruleId: "SN-MNT-012",
      severity: "block" as const,
      title: "t",
      path: "source/x_app",
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
    const { plan } = await computeUnitPlan(gated, { instance: "dev", allowCollisions: false });
    expect(seen).toEqual([["source/x_app"]]);
    expect(plan.ready).toBe(false);
    expect(plan.gate.blocking).toEqual([expect.objectContaining({ ruleId: "SN-MNT-012" })]);
  });
});
