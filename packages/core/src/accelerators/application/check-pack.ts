import type { InventoryReader } from "../../plugins/index";
import { dataOrder, selectCapabilities } from "../domain/capability-graph";
import { InvalidPackError, PackNotFoundError } from "../domain/errors";
import { parseManifest } from "../domain/manifest";
import type { Manifest } from "../domain/manifest-types";
import { type PreflightReport, preflight } from "../domain/preflight";
import type { PackSource } from "../ports";

export interface PackSummary {
  readonly id: string;
  readonly version: string;
  readonly scope: string;
  readonly capabilities: readonly {
    readonly id: string;
    readonly wave: number;
    readonly label: string;
  }[];
}

async function manifestOf(packs: PackSource, id: string): Promise<Manifest> {
  const document = await packs.manifest(id);
  if (document === null) throw new PackNotFoundError(id, await packs.ids());
  const outcome = parseManifest(document);
  if (!outcome.ok) throw new InvalidPackError(id, outcome.problems);
  return outcome.manifest;
}

const summary = (m: Manifest): PackSummary => ({
  id: m.id,
  version: m.version,
  scope: m.scope,
  capabilities: m.capabilities.map(({ id, wave, label }) => ({ id, wave, label })),
});

// The packs snagentic ships.
export async function listPacks(packs: PackSource): Promise<PackSummary[]> {
  const found: PackSummary[] = [];
  for (const id of await packs.ids()) found.push(summary(await manifestOf(packs, id)));
  return found;
}

export interface PackQuery {
  readonly pack: string;
  readonly waves?: readonly number[];
  readonly capabilities?: readonly string[];
  // Checked against this instance's mirrored plugin inventory when given.
  readonly instance?: { readonly root: string; readonly name: string };
  // This snagentic's version.
  readonly snagentic: string;
}

export interface PackCheck {
  readonly pack: PackSummary;
  // Capability ids to install, dependencies first.
  readonly selected: readonly string[];
  readonly unknown: readonly string[];
  // Data entities to load, in order.
  readonly data: readonly string[];
  // Null without an instance, or before its first pull.
  readonly report: PreflightReport | null;
}

// What installing a pack's capabilities needs on an instance (ADR-0026: no call to it).
export async function checkPack(
  deps: { readonly packs: PackSource; readonly inventory: InventoryReader },
  query: PackQuery,
): Promise<PackCheck> {
  const manifest = await manifestOf(deps.packs, query.pack);
  const { capabilities: selected, unknown } = selectCapabilities(manifest, {
    ...(query.waves === undefined ? {} : { waves: query.waves }),
    ...(query.capabilities === undefined ? {} : { capabilities: query.capabilities }),
  });
  const data = dataOrder(manifest, selected).map((e) => e.entity);
  const base = { pack: summary(manifest), selected, unknown, data };
  if (query.instance === undefined) return { ...base, report: null };
  const { root, name } = query.instance;
  const rows = await deps.inventory.read(root, name, "plugins");
  if (rows === null) return { ...base, report: null };
  const plugins = rows.map((row) => ({
    id: row["id"] ?? "",
    active: row["active"] === "active",
    version: row["version"] ?? "",
  }));
  const report = preflight({
    manifest,
    selected,
    plugins,
    snagentic: query.snagentic,
    instance: name,
  });
  return { ...base, report };
}
