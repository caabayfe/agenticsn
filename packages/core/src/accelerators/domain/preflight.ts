import type { Manifest, PluginRequirement } from "./manifest-types";

// Whether a pack's capabilities can be installed on an instance, from the mirror's plugin
// inventory alone (ADR-0026: check reads no instance). Pure.

export type PluginState = "active" | "inactive" | "missing" | "too-old";
// Most serious first: a capability takes the first that applies.
export type CapabilityState = "not-entitled" | "needs-plugins" | "blocked" | "ready";

export interface InstalledPlugin {
  readonly id: string;
  readonly active: boolean;
  readonly version: string;
}

export interface PluginCheck {
  readonly id: string;
  readonly state: PluginState;
  // Installed version, or null when the instance does not have the plugin.
  readonly version: string | null;
  readonly minVersion: string | null;
}

export interface CapabilityReport {
  readonly id: string;
  readonly wave: number;
  readonly state: CapabilityState;
  readonly plugins: readonly PluginCheck[];
  // Commands that make it installable, in order.
  readonly next: readonly string[];
}

export interface PreflightReport {
  // About the pack as a whole; any problem stops the install.
  readonly problems: readonly string[];
  readonly capabilities: readonly CapabilityReport[];
}

const parts = (version: string) => version.split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);

// a < b, comparing numeric segments (1.10.0 is newer than 1.9.4).
export function olderThan(a: string, b: string): boolean {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p !== q) return p < q;
  }
  return false;
}

function checkPlugin(
  required: PluginRequirement,
  installed: InstalledPlugin | undefined,
): PluginCheck {
  const base = { id: required.id, minVersion: required.minVersion };
  if (installed === undefined) return { ...base, state: "missing", version: null };
  const old = required.minVersion !== null && olderThan(installed.version, required.minVersion);
  const state = old ? "too-old" : installed.active ? "active" : "inactive";
  return { ...base, state, version: installed.version };
}

function ownState(plugins: readonly PluginCheck[], required: readonly PluginRequirement[]) {
  const licensed = (id: string) =>
    required.some((r) => r.id === id && r.entitlement === "licensed");
  if (plugins.some((p) => p.state === "missing" && licensed(p.id))) return "not-entitled";
  return plugins.some((p) => p.state !== "active") ? "needs-plugins" : "ready";
}

function nextSteps(plugins: readonly PluginCheck[], instance: string): string[] {
  const inactive = plugins.filter((p) => p.state === "inactive");
  if (inactive.length === 0) return [];
  return [
    ...inactive.map((p) => `snagentic plugins activate ${instance} ${p.id} --confirm`),
    `snagentic pull ${instance}`,
  ];
}

export function preflight(input: {
  readonly manifest: Manifest;
  // Capability ids, dependencies first (selectCapabilities).
  readonly selected: readonly string[];
  readonly plugins: readonly InstalledPlugin[];
  readonly snagentic: string;
  readonly instance: string;
}): PreflightReport {
  const installed = new Map(input.plugins.map((p) => [p.id, p]));
  const states = new Map<string, CapabilityState>();
  const capabilities = input.selected.flatMap((id) => {
    const capability = input.manifest.capabilities.find((c) => c.id === id);
    if (capability === undefined) return [];
    const plugins = capability.plugins.map((r) => checkPlugin(r, installed.get(r.id)));
    const own = ownState(plugins, capability.plugins);
    const waiting = capability.dependsOn.some((d) => states.get(d) !== "ready");
    const state: CapabilityState = own === "ready" && waiting ? "blocked" : own;
    states.set(id, state);
    const next = own === "not-entitled" ? [] : nextSteps(plugins, input.instance);
    return [{ id, wave: capability.wave, state, plugins, next }];
  });
  const needed = input.manifest.requires.snagentic.replace(/^>=\s*/, "");
  const problems =
    needed !== "" && olderThan(input.snagentic, needed)
      ? [
          `the pack needs snagentic ${input.manifest.requires.snagentic}; this is ${input.snagentic}: upgrade with snagentic upgrade`,
        ]
      : [];
  return { problems, capabilities };
}
