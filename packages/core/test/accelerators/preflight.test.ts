import { describe, expect, it } from "bun:test";
import { type Manifest, parseManifest, preflight } from "@snagentic/core";

const manifest = (() => {
  const outcome = parseManifest({
    id: "itsm",
    version: "1.0.0",
    requires: { snagentic: ">=1.8.0" },
    platform: { tested: ["australia", "zurich"] },
    modules: {
      foundation: {
        label: "foundation",
        components: [
          { kind: "plugin", id: "com.snc.cmdb.csdm", minVersion: "2.0.0", entitlement: "free" },
        ],
      },
      incident: {
        label: "incident",
        dependsOn: ["foundation"],
        components: [
          { kind: "plugin", id: "com.snc.on_call_rotation", minVersion: null, entitlement: "free" },
        ],
      },
      ai: {
        label: "ai",
        dependsOn: ["incident"],
        components: [
          { kind: "plugin", id: "com.glide.now_assist", minVersion: null, entitlement: "licensed" },
        ],
      },
      mobile: {
        label: "mobile",
        components: [
          { kind: "app", id: "sn_mobile_agent", minVersion: "3.0.0", entitlement: "free" },
        ],
      },
    },
  });
  if (!outcome.ok) throw new Error(outcome.problems.join("; "));
  return outcome.manifest;
})();

const installed = (id: string, active: boolean, version = "3.1.0") => ({
  kind: "plugin" as const,
  id,
  active,
  version,
});
const installedApp = (scope: string, active: boolean, version = "3.1.0") => ({
  ...installed(scope, active, version),
  kind: "app" as const,
});

const run = (
  overrides: Partial<Parameters<typeof preflight>[0]> = {},
): ReturnType<typeof preflight> =>
  preflight({
    manifest: manifest as Manifest,
    selected: ["foundation", "incident", "ai"],
    components: [
      installed("com.snc.cmdb.csdm", true),
      installed("com.snc.on_call_rotation", false),
    ],
    snagentic: "1.8.0",
    instance: "pdi2",
    ...overrides,
  });

describe("accelerator preflight (ADR-0026, ADR-0038)", () => {
  it("is ready where every required component is active at the version asked", () => {
    expect(run().capabilities[0]).toEqual({
      id: "foundation",
      state: "ready",
      components: [
        {
          kind: "plugin",
          id: "com.snc.cmdb.csdm",
          state: "active",
          version: "3.1.0",
          minVersion: "2.0.0",
          entitlement: "free",
        },
      ],
      next: [],
      waitsOn: [],
      installable: true,
    });
  });

  it("names the exact activate command, then a pull, for a plugin that is installed but inactive", () => {
    expect(run().capabilities[1]).toMatchObject({
      id: "incident",
      state: "needs-components",
      components: [{ id: "com.snc.on_call_rotation", state: "inactive" }],
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
      components: [{ id: "com.glide.now_assist", state: "missing" }],
      next: [],
    });
  });

  it("reports a free plugin the instance lacks, or has at an older version", () => {
    const report = run({
      components: [
        installed("com.snc.cmdb.csdm", true, "1.9.4"),
        installed("com.snc.on_call_rotation", true),
      ],
    });
    expect(report.capabilities[0]).toMatchObject({
      state: "needs-components",
      components: [{ state: "too-old", version: "1.9.4", minVersion: "2.0.0" }],
    });
    const missing = run({ components: [] }).capabilities[0];
    expect(missing).toMatchObject({
      state: "needs-components",
      components: [{ state: "missing" }],
    });
  });

  it("checks a store application like a plugin, and names it in needs-components", () => {
    const check = (components: Parameters<typeof preflight>[0]["components"]) =>
      run({ selected: ["mobile"], components }).capabilities[0];
    expect(check([])).toMatchObject({
      id: "mobile",
      state: "needs-components",
      components: [{ kind: "app", id: "sn_mobile_agent", state: "missing" }],
      next: [],
    });
    expect(check([installedApp("sn_mobile_agent", true, "2.5.0")])).toMatchObject({
      state: "needs-components",
      components: [{ kind: "app", state: "too-old", version: "2.5.0", minVersion: "3.0.0" }],
    });
    // An inactive application has no activate command: plugins activate is for plugins.
    expect(check([installedApp("sn_mobile_agent", false)])).toMatchObject({
      state: "needs-components",
      components: [{ kind: "app", state: "inactive" }],
      next: [],
    });
    expect(check([installedApp("sn_mobile_agent", true)])?.state).toBe("ready");
    // A plugin with the application's scope as its id is not the application.
    expect(check([installed("sn_mobile_agent", true)])?.state).toBe("needs-components");
  });

  it("is blocked when a module it depends on is not ready", () => {
    const report = run({
      components: [
        installed("com.snc.cmdb.csdm", false),
        installed("com.snc.on_call_rotation", true),
      ],
    });
    expect(report.capabilities.map((c) => [c.id, c.state])).toEqual([
      ["foundation", "needs-components"],
      ["incident", "blocked"],
      // Its own missing licence comes first: nothing else would make it installable.
      ["ai", "not-entitled"],
    ]);
  });

  it("names what a blocked module waits on, and whether the install can make it installable", () => {
    const report = run({
      components: [
        installed("com.snc.cmdb.csdm", false),
        installed("com.snc.on_call_rotation", true),
      ],
    });
    expect(report.capabilities.map((c) => [c.id, c.waitsOn, c.installable])).toEqual([
      // An inactive plugin: the install activates it.
      ["foundation", [], true],
      ["incident", ["foundation"], true],
      ["ai", ["incident"], false],
    ]);
    const lacking = run({ components: [installed("com.snc.on_call_rotation", true)] });
    expect(lacking.capabilities.map((c) => [c.id, c.installable])).toEqual([
      ["foundation", false],
      // It waits on a module the install cannot install.
      ["incident", false],
      ["ai", false],
    ]);
  });

  it("reports only the modules selected", () => {
    expect(run({ selected: ["foundation"] }).capabilities.map((c) => c.id)).toEqual(["foundation"]);
  });

  it("refuses a pack that needs a newer snagentic", () => {
    expect(run({ snagentic: "1.7.2" }).problems).toEqual([
      "the pack needs snagentic >=1.8.0; this is 1.7.2: upgrade with snagentic upgrade",
    ]);
    expect(run().problems).toEqual([]);
  });

  it("warns, without blocking, when the instance runs a platform family the pack was not tested on", () => {
    const report = run({ family: "Yokohama" });
    expect(report.warnings).toEqual([
      "the pack was tested on australia, zurich; this instance runs Yokohama: review the plan with care",
    ]);
    expect(report.problems).toEqual([]);
    expect(run({ family: "Zurich" }).warnings).toEqual([]);
    expect(run({ family: null }).warnings).toEqual([]);
    expect(run().warnings).toEqual([]);
  });
});
