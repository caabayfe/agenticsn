import type { InventoryReader } from "../../plugins/index";
import { dataOrder, type Selection, selectCapabilities } from "../domain/capability-graph";
import { InvalidPackError, PackNotFoundError } from "../domain/errors";
import { parseManifest } from "../domain/manifest";
import type { Manifest } from "../domain/manifest-types";
import { packDocument } from "../domain/pack-layout";
import { type PreflightReport, preflight } from "../domain/preflight";
import type { PackSource } from "../ports";

export interface PackSummary {
  readonly id: string;
  readonly version: string;
  readonly modules: readonly { readonly id: string; readonly label: string }[];
  readonly profiles: Readonly<Record<string, readonly string[]>>;
}

// A pack's manifest, from its files (format 2: accelerator.yaml and each module.yaml).
export async function manifestOf(packs: PackSource, id: string): Promise<Manifest> {
  const files = await packs.files(id);
  if (files.size === 0) throw new PackNotFoundError(id, await packs.ids());
  const { document, problems } = packDocument(files, (text) => packs.parse(text));
  if (problems.length > 0) throw new InvalidPackError(id, problems);
  const outcome = parseManifest(document);
  if (!outcome.ok) throw new InvalidPackError(id, outcome.problems);
  return outcome.manifest;
}

const summary = (m: Manifest): PackSummary => ({
  id: m.id,
  version: m.version,
  modules: m.capabilities.map(({ id, label }) => ({ id, label })),
  profiles: m.profiles,
});

// The packs this snagentic and the workspace's pack paths hold.
export async function listPacks(packs: PackSource): Promise<PackSummary[]> {
  const found: PackSummary[] = [];
  for (const id of await packs.ids()) found.push(summary(await manifestOf(packs, id)));
  return found;
}

export interface PackQuery extends Selection {
  readonly pack: string;
  // Checked against this instance's mirrored component inventory when given.
  readonly instance?: { readonly root: string; readonly name: string };
  // This snagentic's version.
  readonly snagentic: string;
}

export interface PackCheck {
  readonly pack: PackSummary;
  // Module ids to install, dependencies first.
  readonly selected: readonly string[];
  readonly unknown: readonly string[];
  // Data entities to load, in order.
  readonly data: readonly string[];
  // Null without an instance, or before its first pull.
  readonly report: PreflightReport | null;
}

export const selectionOf = (query: Selection): Selection => ({
  ...(query.profile === undefined ? {} : { profile: query.profile }),
  ...(query.modules === undefined ? {} : { modules: query.modules }),
});

// What installing a pack's modules needs on an instance (ADR-0026: no call to it).
export async function checkPack(
  deps: { readonly packs: PackSource; readonly inventory: InventoryReader },
  query: PackQuery,
): Promise<PackCheck> {
  const manifest = await manifestOf(deps.packs, query.pack);
  const { capabilities: selected, unknown } = selectCapabilities(manifest, selectionOf(query));
  const data = dataOrder(manifest, selected).map((e) => e.entity);
  const base = { pack: summary(manifest), selected, unknown, data };
  if (query.instance === undefined) return { ...base, report: null };
  const { root, name } = query.instance;
  const plugins = await deps.inventory.read(root, name, "plugins");
  if (plugins === null) return { ...base, report: null };
  const apps = (await deps.inventory.read(root, name, "store_apps")) ?? [];
  // The two inventories say "active" differently (ADR-0013): plugins "active", apps "true".
  const components = [
    ...plugins.map((row) => ({
      kind: "plugin" as const,
      id: row["id"] ?? "",
      active: row["active"] === "active",
      version: row["version"] ?? "",
    })),
    ...apps.map((row) => ({
      kind: "app" as const,
      id: row["scope"] ?? "",
      active: row["active"] === "true",
      version: row["version"] ?? "",
    })),
  ];
  const report = preflight({
    manifest,
    selected,
    components,
    snagentic: query.snagentic,
    instance: name,
  });
  return { ...base, report };
}
