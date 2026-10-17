import { TableName } from "../../kernel/table-name";
import {
  CHILD_TABLES,
  type ChildTable,
  ownerOfBase,
  VARIABLE_TABLE_PREFIX,
  variableModelOf,
} from "../domain/pull-scope";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { tableIds } from "./pull-children";

// Which mirrored record owns the child rows whose parent field holds a given key, and which
// keys belong to a record. The key is usually the record's own sys_id; for tables owned
// through child rows it may also be the sys_id of a row in an earlier child table, exactly as
// the full pull attaches them.
export interface ChildOwners {
  baseOf(key: string): string | undefined;
  keysOf(base: string): readonly string[];
}

// The variable tables that hold rows now, per owning record, in one aggregate request made
// only when the child table changed: a record's rows are refreshed under all of its names.
async function variableTables(
  deps: IncrementalDependencies,
  child: ChildTable,
  signal: AbortSignal,
): Promise<Map<string, string[]>> {
  const table = TableName.parse(child.table);
  const query = `${child.parentField}STARTSWITH${VARIABLE_TABLE_PREFIX}`;
  const byBase = new Map<string, string[]>();
  for (const name of (
    await deps.statistics.countBy(table, child.parentField, signal, query)
  ).keys()) {
    const model = variableModelOf(name);
    const base = model === null ? undefined : deps.records.baseOf(deps.metadataRoot, model);
    if (base !== undefined) {
      byBase.set(base, [...(byBase.get(base) ?? []), name]);
    }
  }
  return byBase;
}

// Rows keyed by table name (choices): each table's record owns the rows that name it, and a
// flow's, action's or test step's record owns the rows of its variable tables.
async function tableNameOwners(
  deps: IncrementalDependencies,
  child: ChildTable,
  signal: AbortSignal,
): Promise<ChildOwners> {
  const byName = new Map<string, string>();
  const names = new Map<string, string>();
  for (const [name, sysId] of await tableIds(deps, signal)) {
    const base = deps.records.baseOf(deps.metadataRoot, sysId);
    if (base !== undefined && name !== "") {
      byName.set(name, base);
      names.set(base, name);
    }
  }
  const variables = await variableTables(deps, child, signal);
  const modelOf = (key: string) => {
    const model = variableModelOf(key);
    return model === null ? undefined : deps.records.baseOf(deps.metadataRoot, model);
  };
  return {
    baseOf: (key) => byName.get(key) ?? modelOf(key),
    keysOf: (base) => {
      const name = names.get(base);
      return [...(name === undefined ? [] : [name]), ...(variables.get(base) ?? [])];
    },
  };
}

export async function childOwners(
  deps: IncrementalDependencies,
  child: ChildTable,
  signal: AbortSignal,
): Promise<ChildOwners> {
  if (child.ownedByTableName === true) {
    return tableNameOwners(deps, child, signal);
  }
  const root = deps.metadataRoot;
  const earlier = CHILD_TABLES.slice(0, CHILD_TABLES.indexOf(child)).map((table) => table.table);
  const rows =
    child.ownedThroughChildRows === true
      ? await deps.records.childRowOwners(root, earlier)
      : new Map<string, string>();
  const keys = new Map<string, string[]>();
  for (const [rowId, base] of rows) {
    const list = keys.get(base) ?? [];
    list.push(rowId);
    keys.set(base, list);
  }
  return {
    baseOf: (key) => deps.records.baseOf(root, key) ?? rows.get(key),
    keysOf: (base) => [ownerOfBase(base), ...(keys.get(base) ?? [])],
  };
}

// Records whose mirrored row count differs from the instance's. Instance counts are per
// parent key, so they are added up per owning record first.
export async function ownersWithOtherCounts(
  deps: IncrementalDependencies,
  child: ChildTable,
  owners: ChildOwners,
  signal: AbortSignal,
): Promise<Set<string>> {
  const table = TableName.parse(child.table);
  const byKey = await deps.statistics.countBy(table, child.parentField, signal);
  const current = new Map<string, number>();
  for (const [key, count] of byKey) {
    const base = owners.baseOf(key);
    if (base !== undefined) {
      current.set(base, (current.get(base) ?? 0) + count);
    }
  }
  const mirrored = await deps.records.countChildRows(deps.metadataRoot, child.table);
  const differing = new Set<string>();
  for (const base of new Set([...current.keys(), ...mirrored.keys()])) {
    if ((current.get(base) ?? 0) !== (mirrored.get(base) ?? 0)) {
      differing.add(base);
    }
  }
  return differing;
}
