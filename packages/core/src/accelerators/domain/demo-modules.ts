import type { Manifest } from "./manifest-types";
import type { ComponentCheck } from "./preflight";

// --demo is the one demo switch (ADR-0048): with it, a profile's demo modules are installed and
// the store applications that declare demo data bring it; without it, both are left out. Only a
// development instance gets demo data. Pure.

export interface DemoChoice {
  // The selected modules the plan keeps, dependencies first.
  readonly kept: readonly string[];
  // Demo modules the selection holds and the plan leaves out.
  readonly leftOut: readonly string[];
  readonly problems: readonly string[];
}

export function demoChoice(input: {
  readonly manifest: Manifest;
  // Selected modules, dependencies first (selectCapabilities).
  readonly selected: readonly string[];
  // Modules named with --modules.
  readonly named: readonly string[];
  readonly demo: boolean;
  readonly development: boolean;
}): DemoChoice {
  if (input.demo) {
    // Demo content never reaches test or production, whoever plans it (ADR-0049, item 5).
    const problems = input.development ? [] : ["--demo is for development instances only"];
    return { kept: input.selected, leftOut: [], problems };
  }
  const isDemo = new Set(
    input.manifest.capabilities.filter((c) => c.demo === true).map((c) => c.id),
  );
  return {
    kept: input.selected.filter((id) => !isDemo.has(id)),
    leftOut: input.selected.filter((id) => isDemo.has(id)),
    problems: input.named
      .filter((id) => isDemo.has(id))
      .map((id) => `${id} is a demo module: install it with --demo, or leave it out`),
  };
}

// Whether the install loads a planned component's own demo data: declared by the pack, asked
// with --demo, on a development instance, and only when the install installs it.
export function loadsDemoData(
  check: Pick<ComponentCheck, "state">,
  declared: boolean,
  demo: boolean,
): boolean {
  return declared && demo && check.state === "available";
}

// Applications already installed cannot load their demo data any more: said, not blocking.
export function demoDataWarnings(
  checks: readonly (Pick<ComponentCheck, "id" | "state"> & { readonly declared: boolean })[],
  demo: boolean,
): string[] {
  if (!demo) return [];
  return checks
    .filter((c) => c.declared && c.state !== "available" && c.state !== "missing")
    .map(
      (c) =>
        `${c.id} is already installed: its demo data loads only when it is installed, so --demo cannot add it`,
    );
}

// The settings the kept demo modules declare, set only with --demo on development (ADR-0049).
export function demoSettings(
  manifest: Manifest,
  kept: readonly string[],
  demo: boolean,
): Readonly<Record<string, string>> {
  if (!demo) return {};
  return Object.fromEntries(
    manifest.capabilities
      .filter((c) => kept.includes(c.id))
      .flatMap((c) => Object.entries(c.demoSettings ?? {}))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

// The on-demand load jobs the kept demo modules declare, dependencies first (ADR-0050).
export function demoJobs(
  manifest: Manifest,
  kept: readonly string[],
  demo: boolean,
): readonly string[] {
  if (!demo) return [];
  return kept.flatMap((id) => manifest.capabilities.find((c) => c.id === id)?.demoJobs ?? []);
}
