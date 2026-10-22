import { describe, expect, it } from "bun:test";
import { computeUnitPlan, type InventoryReader, packFindings } from "@snagentic/core";
import { unitSetup } from "../delivery/unit-fixture";
import { memoryPacks, packFiles } from "../support/memory-packs";

const packs = memoryPacks({
  minimal: packFiles({
    pack: { id: "minimal", version: "1.0.0", requires: { snagentic: ">=1.6.0" } },
    modules: {
      base: { label: "base" },
      extra: {
        label: "extra",
        dependsOn: ["base"],
        components: [{ kind: "plugin", id: "com.snc.on_call_rotation", entitlement: "free" }],
      },
    },
    files: {
      "modules/base/source/x_snagentic_min/src/fluent/app.now.ts": "Record({})",
      "modules/extra/source/global/src/fluent/rule.now.ts": "BusinessRule({})",
      "modules/extra/source/x_snagentic_min/now.config.json": "{}",
      "modules/extra/adopt.yaml": "[]",
    },
  }),
});
const inventory = (state: "active" | "inactive"): InventoryReader => ({
  read: async (_r, _i, file) =>
    file === "plugins"
      ? [{ id: "com.snc.on_call_rotation", active: state, version: "1.0.0" }]
      : null,
});
const QUERY = { instance: { root: "/w", name: "pdi2" }, snagentic: "1.6.0" };

describe("the gate's accelerator check (SN-MNT-012, ADR-0026, ADR-0031)", () => {
  it("blocks a planned project a module ships into while it is not ready, with the commands that fix it", async () => {
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
        message: "module extra of minimal is needs-components: com.snc.on_call_rotation",
        remediation:
          "snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm; then snagentic pull pdi2; then plan again",
      }),
    ]);
  });

  it("names only the modules that are not ready, when several ship into one project", async () => {
    const findings = await packFindings(
      { packs, inventory: inventory("inactive") },
      { ...QUERY, paths: ["source/x_snagentic_min"] },
    );
    expect(findings.map((f) => [f.path, f.message])).toEqual([
      [
        "source/x_snagentic_min",
        "module extra of minimal is needs-components: com.snc.on_call_rotation",
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
      message: "module extra of minimal is needs-components",
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
