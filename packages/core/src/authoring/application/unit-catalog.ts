import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { Catalog, type CatalogData } from "../../metadata/domain/catalog";
import { KeysetPager } from "../../sync/application/keyset-pager";
import type { BuiltUnit } from "../domain/unit";

// Tables per request when reading their dictionary types.
const TABLE_BATCH = 50;

// The catalog that says which of the units' fields hold secrets: the workspace's, else the
// dictionary types of the units' own tables, read in batches (ancestors' fields are then known
// by name only).
export async function unitCatalog(
  dependencies: {
    readonly reader: InstanceReader;
    readonly signal: AbortSignal;
    readonly catalog?: CatalogData | null;
  },
  units: readonly BuiltUnit[],
): Promise<Catalog> {
  if (dependencies.catalog !== undefined && dependencies.catalog !== null) {
    return new Catalog(dependencies.catalog);
  }
  const tables = [
    ...new Set(units.flatMap((unit) => [unit.head.table, ...unit.children.map((c) => c.table)])),
  ].sort();
  const typedFields: Record<string, Record<string, string>> = {};
  const pager = new KeysetPager(dependencies.reader);
  for (let start = 0; start < tables.length; start += TABLE_BATCH) {
    const listing = {
      table: TableName.parse("sys_dictionary"),
      fields: ["sys_id", "name", "element", "internal_type"],
      kind: "snapshot" as const,
      base: `nameIN${tables.slice(start, start + TABLE_BATCH).join(",")}`,
    };
    for await (const row of pager.rows(listing, dependencies.signal)) {
      const table = row["name"] ?? "";
      const element = row["element"] ?? "";
      if (element !== "") {
        typedFields[table] = { ...typedFields[table], [element]: row["internal_type"] ?? "" };
      }
    }
  }
  const parents = Object.fromEntries(tables.map((table) => [table, null]));
  return new Catalog({ parents, scopes: {}, typedFields });
}
