import type { Capability, Manifest } from "./manifest-types";

// The client's licences, stated with --licences: the install keeps the modules they cover (ADR-0059). A licensed component names its
// licence, or is named by its own id; a free one never filters. Pure.

export interface LicenceChoice {
  // The selected modules the plan keeps, dependencies first.
  readonly kept: readonly string[];
  readonly leftOut: readonly { readonly id: string; readonly reason: string }[];
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

// The licences a module's components need.
export const licencesOf = (module: Capability): string[] => [
  ...new Set(
    module.components.filter((c) => c.entitlement === "licensed").map((c) => c.licence ?? c.id),
  ),
];

const named = (manifest: Manifest, licence: string) =>
  manifest.licences[licence] ? `${licence} (${manifest.licences[licence]})` : licence;

// What the stated licences may name: the pack's licences, and the licensed components of its modules.
function unknownLicences(manifest: Manifest, stated: readonly string[]): string[] {
  const known = new Set([
    ...Object.keys(manifest.licences),
    ...manifest.capabilities.flatMap(licencesOf),
  ]);
  const list = Object.keys(manifest.licences).sort().join(", ");
  return stated
    .filter((l) => !known.has(l))
    .map(
      (l) =>
        `--licences names ${l}, which is no licence of the pack${list === "" ? "" : ` (${list})`} nor a licensed component of its modules`,
    );
}

export function licenceChoice(input: {
  readonly manifest: Manifest;
  // Selected modules, dependencies first.
  readonly selected: readonly string[];
  readonly stated?: readonly string[] | undefined;
}): LicenceChoice {
  const { manifest, selected, stated } = input;
  const moduleOf = (id: string) => manifest.capabilities.find((c) => c.id === id);
  if (stated === undefined) {
    const needed = [...new Set(selected.flatMap((id) => licencesOf(moduleOf(id) ?? EMPTY)))].sort();
    const warnings =
      needed.length === 0
        ? []
        : [
            `the selected modules need these licences: ${needed.map((l) => named(manifest, l)).join(", ")}; state the client's with --licences to install only what they cover`,
          ];
    return { kept: selected, leftOut: [], problems: [], warnings };
  }
  const leftOut: { id: string; reason: string }[] = [];
  for (const id of selected) {
    const module = moduleOf(id) ?? EMPTY;
    const missing = licencesOf(module).filter((l) => !stated.includes(l));
    const upstream = module.dependsOn.filter((d) => leftOut.some((m) => m.id === d));
    if (missing.length > 0) {
      const which = missing.map((l) => named(manifest, l)).join(", ");
      leftOut.push({ id, reason: `needs the licence ${which}, which --licences does not state` });
    } else if (upstream.length > 0) {
      leftOut.push({
        id,
        reason: `depends on ${upstream.join(", ")}, which the stated licences leave out`,
      });
    }
  }
  const kept = selected.filter((id) => !leftOut.some((m) => m.id === id));
  return { kept, leftOut, problems: unknownLicences(manifest, stated), warnings: [] };
}

const EMPTY: Capability = {
  id: "",
  label: "",
  dependsOn: [],
  components: [],
  data: [],
  fields: [],
};
