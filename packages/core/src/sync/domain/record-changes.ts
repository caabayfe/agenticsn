import type { Catalog } from "../../metadata/domain/catalog";

// What the change feeds of sys_metadata and sys_metadata_delete reported since the watermark.
export interface RecordChanges {
  // Class -> sys_ids of records created or updated.
  readonly changed: ReadonlyMap<string, readonly string[]>;
  // Scope sys_ids of the changed records.
  readonly scopes: ReadonlySet<string>;
  // sys_ids of deleted records.
  readonly deleted: readonly string[];
}

// Classes whose records describe the catalog itself: tables and field types.
const CATALOG_CLASSES = new Set(["sys_db_object", "sys_dictionary"]);

// The stored catalog no longer describes the changed records: a table or field type changed,
// or a record is in a class or scope the catalog does not know.
export function needsNewCatalog(changes: RecordChanges, catalog: Catalog): boolean {
  return (
    [...changes.changed.keys()].some(
      (table) => CATALOG_CLASSES.has(table) || !catalog.isMetadata(table),
    ) || [...changes.scopes].some((scope) => !catalog.knowsScope(scope))
  );
}

// A record's own files (YAML and field files) are rewritten when it changes; its child-row
// files belong to the child tables and follow the record when it moves.
export function isChildRowFile(base: string, path: string): boolean {
  return path.startsWith(`${base}.children.`);
}

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    result.push(items.slice(start, start + size));
  }
  return result;
}
