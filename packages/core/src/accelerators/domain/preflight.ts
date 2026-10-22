import type { Component, Manifest } from "./manifest-types";

// Whether a pack's modules can be installed on an instance, from the mirror's component
// inventory alone (ADR-0026: check reads no instance). Pure.

export type ComponentState = "active" | "inactive" | "missing" | "too-old";
// Most serious first: a module takes the first that applies.
export type CapabilityState = "not-entitled" | "needs-components" | "blocked" | "ready";

export interface InstalledComponent {
  readonly kind: Component["kind"];
  // A plugin's id, or a store application's scope.
  readonly id: string;
  readonly active: boolean;
  readonly version: string;
}

export interface ComponentCheck {
  readonly kind: Component["kind"];
  readonly id: string;
  readonly state: ComponentState;
  // Installed version, or null when the instance does not have it.
  readonly version: string | null;
  readonly minVersion: string | null;
  readonly entitlement: Component["entitlement"];
}

export interface CapabilityReport {
  readonly id: string;
  readonly state: CapabilityState;
  readonly components: readonly ComponentCheck[];
  // Commands that make it installable, in order.
  readonly next: readonly string[];
}

export interface PreflightReport {
  // About the pack as a whole; any problem stops the install.
  readonly problems: readonly string[];
  // About the pack as a whole; shown, never blocking.
  readonly warnings: readonly string[];
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

function checkComponent(
  required: Component,
  installed: InstalledComponent | undefined,
): ComponentCheck {
  const base = {
    kind: required.kind,
    id: required.id,
    minVersion: required.minVersion,
    entitlement: required.entitlement,
  };
  if (installed === undefined) return { ...base, state: "missing", version: null };
  const old = required.minVersion !== null && olderThan(installed.version, required.minVersion);
  const state = old ? "too-old" : installed.active ? "active" : "inactive";
  return { ...base, state, version: installed.version };
}

function ownState(components: readonly ComponentCheck[]): CapabilityState {
  if (components.some((c) => c.state === "missing" && c.entitlement === "licensed")) {
    return "not-entitled";
  }
  return components.some((c) => c.state !== "active") ? "needs-components" : "ready";
}

function nextSteps(components: readonly ComponentCheck[], instance: string): string[] {
  const inactive = components.filter((c) => c.state === "inactive" && c.kind === "plugin");
  if (inactive.length === 0) return [];
  return [
    ...inactive.map((c) => `snagentic plugins activate ${instance} ${c.id} --confirm`),
    `snagentic pull ${instance}`,
  ];
}

function packProblems(manifest: Manifest, snagentic: string): string[] {
  const needed = manifest.requires.snagentic.replace(/^>=\s*/, "");
  return needed !== "" && olderThan(snagentic, needed)
    ? [
        `the pack needs snagentic ${manifest.requires.snagentic}; this is ${snagentic}: upgrade with snagentic upgrade`,
      ]
    : [];
}

function packWarnings(manifest: Manifest, family: string | null): string[] {
  if (family === null || manifest.tested.length === 0) return [];
  return manifest.tested.includes(family.toLowerCase())
    ? []
    : [
        `the pack was tested on ${manifest.tested.join(", ")}; this instance runs ${family}: review the plan with care`,
      ];
}

export function preflight(input: {
  readonly manifest: Manifest;
  // Module ids, dependencies first (selectCapabilities).
  readonly selected: readonly string[];
  readonly components: readonly InstalledComponent[];
  readonly snagentic: string;
  readonly instance: string;
  // The instance's platform family ("australia"), when known.
  readonly family?: string | null;
}): PreflightReport {
  const keyOf = (c: { readonly kind: string; readonly id: string }) => `${c.kind}:${c.id}`;
  const installed = new Map(input.components.map((c) => [keyOf(c), c]));
  const states = new Map<string, CapabilityState>();
  const capabilities = input.selected.flatMap((id) => {
    const capability = input.manifest.capabilities.find((c) => c.id === id);
    if (capability === undefined) return [];
    const components = capability.components.map((r) => checkComponent(r, installed.get(keyOf(r))));
    const own = ownState(components);
    const waiting = capability.dependsOn.some((d) => states.get(d) !== "ready");
    const state: CapabilityState = own === "ready" && waiting ? "blocked" : own;
    states.set(id, state);
    const next = own === "not-entitled" ? [] : nextSteps(components, input.instance);
    return [{ id, state, components, next }];
  });
  return {
    problems: packProblems(input.manifest, input.snagentic),
    warnings: packWarnings(input.manifest, input.family ?? null),
    capabilities,
  };
}
