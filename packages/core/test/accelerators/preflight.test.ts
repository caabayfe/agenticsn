import { describe, expect, it } from "bun:test";
import { type Manifest, parseManifest, preflight } from "@snagentic/core";

const manifest = (() => {
  const outcome = parseManifest({
    id: "itsm",
    version: "1.0.0",
    requires: { snagentic: ">=1.8.0" },
    scope: "x_nttdata_acc",
    capabilities: {
      foundation: {
        wave: 0,
        label: "foundation",
        plugins: [{ id: "com.snc.cmdb.csdm", minVersion: "2.0.0", entitlement: "free" }],
      },
      incident: {
        wave: 1,
        label: "incident",
        dependsOn: ["foundation"],
        plugins: [{ id: "com.snc.on_call_rotation", minVersion: null, entitlement: "free" }],
      },
      ai: {
        wave: 1,
        label: "ai",
        dependsOn: ["incident"],
        plugins: [{ id: "com.glide.now_assist", minVersion: null, entitlement: "licensed" }],
      },
    },
  });
  if (!outcome.ok) throw new Error(outcome.problems.join("; "));
  return outcome.manifest;
})();

const plugin = (id: string, active: boolean, version = "3.1.0") => ({ id, active, version });

const run = (
  overrides: Partial<Parameters<typeof preflight>[0]> = {},
): ReturnType<typeof preflight> =>
  preflight({
    manifest: manifest as Manifest,
    selected: ["foundation", "incident", "ai"],
    plugins: [plugin("com.snc.cmdb.csdm", true), plugin("com.snc.on_call_rotation", false)],
    snagentic: "1.8.0",
    instance: "pdi2",
    ...overrides,
  });

describe("accelerator preflight (ADR-0026)", () => {
  it("is ready where every required plugin is active at the version asked", () => {
    expect(run().capabilities[0]).toEqual({
      id: "foundation",
      wave: 0,
      state: "ready",
      plugins: [
        { id: "com.snc.cmdb.csdm", state: "active", version: "3.1.0", minVersion: "2.0.0" },
      ],
      next: [],
    });
  });

  it("names the exact activate command, then a pull, for a plugin that is installed but inactive", () => {
    expect(run().capabilities[1]).toMatchObject({
      id: "incident",
      state: "needs-plugins",
      plugins: [{ id: "com.snc.on_call_rotation", state: "inactive" }],
      next: [
        "snagentic plugins activate pdi2 com.snc.on_call_rotation --confirm",
        "snagentic pull pdi2",
      ],
    });
  });

  it("says a licensed plugin the instance does not have is not entitled, with no command", () => {
    expect(run().capabilities[2]).toMatchObject({
      id: "ai",
      state: "not-entitled",
      plugins: [{ id: "com.glide.now_assist", state: "missing" }],
      next: [],
    });
  });

  it("reports a free plugin the instance lacks, or has at an older version", () => {
    const report = run({
      plugins: [
        plugin("com.snc.cmdb.csdm", true, "1.9.4"),
        plugin("com.snc.on_call_rotation", true),
      ],
    });
    expect(report.capabilities[0]).toMatchObject({
      state: "needs-plugins",
      plugins: [{ state: "too-old", version: "1.9.4", minVersion: "2.0.0" }],
    });
    const missing = run({ plugins: [] }).capabilities[0];
    expect(missing).toMatchObject({ state: "needs-plugins", plugins: [{ state: "missing" }] });
  });

  it("is blocked when a capability it depends on is not ready", () => {
    const report = run({
      plugins: [plugin("com.snc.cmdb.csdm", false), plugin("com.snc.on_call_rotation", true)],
    });
    expect(report.capabilities.map((c) => [c.id, c.state])).toEqual([
      ["foundation", "needs-plugins"],
      ["incident", "blocked"],
      // Its own missing licence comes first: nothing else would make it installable.
      ["ai", "not-entitled"],
    ]);
  });

  it("reports only the capabilities selected", () => {
    expect(run({ selected: ["foundation"] }).capabilities.map((c) => c.id)).toEqual(["foundation"]);
  });

  it("refuses a pack that needs a newer snagentic", () => {
    expect(run({ snagentic: "1.7.2" }).problems).toEqual([
      "the pack needs snagentic >=1.8.0; this is 1.7.2: upgrade with snagentic upgrade",
    ]);
    expect(run().problems).toEqual([]);
  });
});
