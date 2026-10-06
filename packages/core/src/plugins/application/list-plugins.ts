import type { Row } from "../../kernel/row";
import type { SyncStateStore } from "../../sync/ports";
import type { InventoryReader } from "../ports";

export interface Plugin {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
  readonly version: string;
  readonly scope: string;
}

export interface StoreApp {
  readonly scope: string;
  readonly name: string;
  readonly version: string;
  readonly active: boolean;
  readonly vendor: string;
}

export interface PluginFilter {
  // Case-insensitive text in the id, scope or name.
  readonly text?: string;
  readonly state?: "active" | "inactive" | "all";
}

export interface PluginInventory {
  readonly plugins: readonly Plugin[];
  readonly storeApps: readonly StoreApp[];
  // Watermark of the pull the inventory comes from.
  readonly asOf: string | null;
}

const plugin = (row: Row): Plugin => ({
  id: row["id"] ?? "",
  name: row["name"] ?? "",
  active: row["active"] === "active",
  version: row["version"] ?? "",
  scope: row["scope"] ?? "",
});

const storeApp = (row: Row): StoreApp => ({
  scope: row["scope"] ?? "",
  name: row["name"] ?? "",
  version: row["version"] ?? "",
  active: row["active"] === "true",
  vendor: row["vendor"] ?? "",
});

function matches(filter: PluginFilter, active: boolean, ...texts: string[]): boolean {
  const state = filter.state ?? "all";
  if ((state === "active" && !active) || (state === "inactive" && active)) {
    return false;
  }
  const needle = filter.text?.toLowerCase() ?? "";
  return needle === "" || texts.some((text) => text.toLowerCase().includes(needle));
}

// Installed and available plugins and store applications, from the mirrored inventory.
export async function listPlugins(
  inventory: InventoryReader,
  state: SyncStateStore,
  root: string,
  instance: string,
  filter: PluginFilter,
): Promise<PluginInventory | null> {
  const plugins = await inventory.read(root, instance, "plugins");
  if (plugins === null) {
    return null;
  }
  const apps = (await inventory.read(root, instance, "store_apps")) ?? [];
  return {
    plugins: plugins.map(plugin).filter((p) => matches(filter, p.active, p.id, p.scope, p.name)),
    storeApps: apps.map(storeApp).filter((a) => matches(filter, a.active, a.scope, a.name)),
    asOf: (await state.readState())?.watermark ?? null,
  };
}
