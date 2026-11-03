import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { classesToPull } from "../domain/pull-scope";
import { mirroredRecord } from "../domain/verify-buckets";
import type { IncrementalDependencies } from "./incremental-dependencies";

// What verification compares: the mirror's sys_ids and the instance's counts, per scope folder.

const SYS_METADATA = TableName.parse("sys_metadata");

export async function mirroredByScope(
  deps: IncrementalDependencies,
): Promise<Map<string, string[]>> {
  const byScope = new Map<string, string[]>();
  for await (const base of deps.records.bases(deps.metadataRoot)) {
    const record = mirroredRecord(base);
    if (record !== null) {
      const ids = byScope.get(record.scope) ?? [];
      ids.push(record.sysId);
      byScope.set(record.scope, ids);
    }
  }
  return byScope;
}

export async function instanceByScope(
  deps: IncrementalDependencies,
  catalog: Catalog,
  excluded: string,
  signal: AbortSignal,
): Promise<Map<string, { scopeIds: string[]; count: number }>> {
  const counts = await deps.statistics.countBy(SYS_METADATA, "sys_scope", signal, excluded);
  const byScope = new Map<string, { scopeIds: string[]; count: number }>();
  for (const [scopeId, count] of counts) {
    const scope = String(catalog.scopeNamespace(scopeId));
    const entry = byScope.get(scope) ?? { scopeIds: [], count: 0 };
    entry.scopeIds.push(scopeId);
    entry.count += count;
    byScope.set(scope, entry);
  }
  return byScope;
}

// Classes a pull never mirrors are left out of every count and listing.
export function exclusion(catalog: Catalog, unreadable: readonly string[]): string {
  const pulled = new Set(classesToPull(catalog));
  const excluded = [
    ...catalog.metadataClasses().filter((table) => !pulled.has(table)),
    ...unreadable,
  ];
  return excluded.length === 0
    ? ""
    : `sys_class_nameNOT IN${[...new Set(excluded)].sort().join(",")}`;
}
