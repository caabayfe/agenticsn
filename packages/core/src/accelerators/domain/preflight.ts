import { olderThan } from "../../kernel/version-order";
import type { Component, Manifest } from "./manifest-types";

export { olderThan };

// Whether a pack's modules can be installed on an instance, from the mirror's component
// inventory alone (ADR-0026: check reads no instance). Pure.

// available: a store application the instance lacks and the store offers (spec 011, I3).
export type ComponentState = "active" | "inactive" | "available" | "missing" | "too-old";
// Most serious first: a module takes the first that applies.
export type CapabilityState = "not-entitled" | "needs-components" | "blocked" | "ready";

export interface InstalledComponent {
  readonly kind: Component["kind"];
  // A plugin's id, or a store application's scope.
  readonly id: string;
  readonly active: boolean;
  readonly version: string;
}

// A store application the instance's store offers, read live when an install is planned: the
// mirror's inventory holds only what is installed.
export interface AvailableApp {
  readonly scope: string;
  // The store's latest version: the one an install gets.
  readonly version: string;
  // The store refuses to install it on this instance.
  readonly blocked: boolean;
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
  // Commands that make it installable by hand, in order.
  readonly next: readonly string[];
  // The modules it depends on that are not ready yet (why it is blocked).
  readonly waitsOn: readonly string[];
  // Whether accelerator install can install it as the instance is: what it lacks is only
  // plugins the install activates, here or in the modules it waits on (spec 011, section 15).
  readonly installable: boolean;
}

export interface PreflightReport {
  // About the pack as a whole; any problem stops the install.
  readonly problems: readonly string[];
  // About the pack as a whole; shown, never blocking.
  readonly warnings: readonly string[];
  readonly capabilities: readonly CapabilityReport[];
}

const offers = (required: Component, offer: AvailableApp | undefined): offer is AvailableApp =>
  required.kind === "app" &&
  offer !== undefined &&
  !offer.blocked &&
  (required.minVersion === null || !olderThan(offer.version, required.minVersion));

function checkComponent(
  required: Component,
  installed: InstalledComponent | undefined,
  offer: AvailableApp | undefined,
): ComponentCheck {
  const base = {
    kind: required.kind,
    id: required.id,
    minVersion: required.minVersion,
    entitlement: required.entitlement,
  };
  if (installed === undefined) {
    return offers(required, offer)
      ? { ...base, state: "available", version: offer.version }
      : { ...base, state: "missing", version: null };
  }
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

// Active, or what the install gets through the platform's installer: an inactive plugin it
// activates, a store application the store offers.
const activatedByInstall = (c: ComponentCheck) =>
  c.state === "active" ||
  c.state === "available" ||
  (c.state === "inactive" && c.kind === "plugin");

function nextSteps(components: readonly ComponentCheck[], instance: string): string[] {
  const commands = components.flatMap((c) => {
    if (c.state === "inactive" && c.kind === "plugin") {
      return [`snagentic plugins activate ${instance} ${c.id} --confirm`];
    }
    return c.state === "available"
      ? [`snagentic apps install ${instance} ${c.id} --version ${c.version} --confirm`]
      : [];
  });
  return commands.length === 0 ? [] : [...commands, `snagentic pull ${instance}`];
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
  // Store applications the store offers; empty where it was not read (accelerator check).
  readonly available?: readonly AvailableApp[];
  readonly snagentic: string;
  readonly instance: string;
  // The instance's platform family ("australia"), when known.
  readonly family?: string | null;
}): PreflightReport {
  const keyOf = (c: { readonly kind: string; readonly id: string }) => `${c.kind}:${c.id}`;
  const installed = new Map(input.components.map((c) => [keyOf(c), c]));
  const store = new Map((input.available ?? []).map((a) => [a.scope, a]));
  const states = new Map<string, CapabilityState>();
  const installable = new Map<string, boolean>();
  const capabilities = input.selected.flatMap((id) => {
    const capability = input.manifest.capabilities.find((c) => c.id === id);
    if (capability === undefined) return [];
    const components = capability.components.map((r) =>
      checkComponent(r, installed.get(keyOf(r)), store.get(r.id)),
    );
    const own = ownState(components);
    const waitsOn = capability.dependsOn.filter((d) => states.get(d) !== "ready");
    const state: CapabilityState = own === "ready" && waitsOn.length > 0 ? "blocked" : own;
    states.set(id, state);
    const can =
      components.every(activatedByInstall) &&
      capability.dependsOn.every((d) => installable.get(d) !== false);
    installable.set(id, can);
    const next = own === "not-entitled" ? [] : nextSteps(components, input.instance);
    return [{ id, state, components, next, waitsOn, installable: can }];
  });
  return {
    problems: packProblems(input.manifest, input.snagentic),
    warnings: packWarnings(input.manifest, input.family ?? null),
    capabilities,
  };
}
