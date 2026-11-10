import { describe, expect, it } from "bun:test";
import type { InstallPlan, PlannedModule } from "../../src/accelerators/domain/install-plan";
import { installedResult, withoutRefused } from "../../src/accelerators/domain/refused-components";

const module = (id: string, dependsOn: readonly string[] = []): PlannedModule => ({
  id,
  label: id,
  dependsOn,
  files: [],
  adoptions: [],
  ensures: [],
  deletions: [],
});

// Only the parts withoutRefused reads; the rest of the plan passes through unchanged.
const PLAN = {
  modules: [module("a"), module("b"), module("c", ["a", "b"])],
  skipped: [{ id: "z", reason: "planned out" }],
  components: [
    { kind: "app", id: "sn_a", modules: ["a"] },
    { kind: "app", id: "sn_b", modules: ["b"] },
  ],
  fields: [
    { module: "a", table: "incident", field: "x" },
    { module: "b", table: "incident", field: "y" },
  ],
  data: {
    source: "demo",
    entities: [
      { entity: "ea", module: "a" },
      { entity: "eb", module: "b" },
    ],
  },
} as unknown as InstallPlan;

describe("the plan without refused components", () => {
  it("is the same plan when nothing was refused", () => {
    expect(withoutRefused(PLAN, []).plan).toBe(PLAN);
  });

  it("leaves out the refused component's modules, their fields and data, and their dependents", () => {
    const { plan, skipped } = withoutRefused(PLAN, [{ kind: "app", id: "sn_a", reason: "no" }]);
    expect(plan.modules.map((m) => m.id)).toEqual(["b"]);
    expect(plan.fields.map((f) => f.module)).toEqual(["b"]);
    expect(plan.data.entities.map((e) => e.entity)).toEqual(["eb"]);
    expect(plan.skipped.map((s) => s.id)).toEqual(["z", "a", "c"]);
    expect(skipped[1]?.reason).toBe("depends on a, which is skipped");
  });

  it("names every skipped module a dependent waits on", () => {
    const { skipped } = withoutRefused(PLAN, [
      { kind: "app", id: "sn_a", reason: "no" },
      { kind: "app", id: "sn_b", reason: "no" },
    ]);
    expect(skipped.at(-1)?.reason).toBe("depends on a, b, which are skipped");
  });

  it("no longer names a module a resumed run delivered after all", () => {
    const steps = [
      { step: "skip module a", outcome: "skipped" as const, detail: "", seconds: 0 },
      { step: "module a", outcome: "done" as const, detail: "", seconds: 0 },
    ];
    expect(installedResult({ planId: "p", startedAt: "t", steps })).toBe("installed");
  });
});
