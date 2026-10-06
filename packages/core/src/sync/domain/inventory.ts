// The operational inventory: what is installed on the instance, one small YAML per source,
// curated fields only (ADR-0017). Read by `plugins list` without calling the instance.

// How an incremental pull notices that a source changed without listing it:
//   active-count  row counts grouped by the active field (activating a plugin moves one)
//   fingerprint   row count and latest update (installing or upgrading an app moves it)
export type InventorySignal = "active-count" | "fingerprint";

export interface InventorySource {
  // File name under instances/<name>/operational, without .yaml.
  readonly file: string;
  readonly table: string;
  readonly base: string;
  // Identifies a row across instances (plugin rows have no stable sys_id).
  readonly key: string;
  readonly fields: readonly string[];
  // Absent: refreshed only by full pulls and verification.
  readonly signal?: InventorySignal;
}

export const INVENTORY: readonly InventorySource[] = [
  {
    file: "plugins",
    table: "v_plugin",
    base: "",
    key: "id",
    fields: ["id", "name", "active", "version", "scope"],
    signal: "active-count",
  },
  // sys_store_app itself is not readable even by admin; its rows are, through sys_scope.
  {
    file: "store_apps",
    table: "sys_scope",
    base: "sys_class_name=sys_store_app",
    key: "scope",
    fields: ["scope", "name", "version", "active", "vendor", "source"],
    signal: "fingerprint",
  },
  {
    file: "domains",
    table: "domain",
    base: "",
    key: "sys_id",
    fields: ["sys_id", "name", "parent", "active"],
  },
];

// A comparable summary of a source's change signal.
export function inventorySignature(counts: ReadonlyMap<string, number>): string {
  return [...counts]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([value, count]) => `${value}=${count}`)
    .join(",");
}
