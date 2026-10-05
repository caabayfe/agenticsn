import { AccessDeniedError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { fieldsToRedact } from "../../metadata/domain/redaction";
import type { FingerprintChange } from "../domain/fingerprint";
import { CHILD_TABLES, type ChildTable, childFamily, childGrouper } from "../domain/pull-scope";
import { chunks } from "../domain/record-changes";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { cleaned, groupTable, owners } from "./pull-children";

// Owner sys_ids per request when refreshing an owner's child rows.
const OWNER_BATCH = 100;

export interface ChildOutcome {
  readonly childFiles: number;
  readonly removedChildFiles: number;
  readonly unreadable: readonly string[];
}

interface Totals {
  childFiles: number;
  removedChildFiles: number;
}

const childFile = (base: string, table: string) => `${base}.children.${table}.yaml`;

// Writes an owner's current child rows, or removes its file when it has none left.
async function store(
  deps: IncrementalDependencies,
  base: string,
  table: string,
  rows: readonly Row[] | undefined,
  totals: Totals,
): Promise<void> {
  const path = childFile(base, table);
  if (rows !== undefined && rows.length > 0) {
    await deps.records.writeDocument(deps.metadataRoot, path, rows);
    totals.childFiles += 1;
  } else if (deps.records.filesOf(deps.metadataRoot, base).includes(path)) {
    await deps.records.remove(deps.metadataRoot, path);
    totals.removedChildFiles += 1;
  }
}

// Changed rows name their owners; each owner's rows are then read again whole, so rows
// deleted from an owner that also changed disappear too.
async function refreshOwners(
  deps: IncrementalDependencies,
  catalog: Catalog,
  child: ChildTable,
  since: string,
  signal: AbortSignal,
  totals: Totals,
): Promise<void> {
  const table = TableName.parse(child.table);
  const feed = {
    table,
    fields: ["sys_id", "sys_updated_on", child.parentField],
    kind: "change-feed" as const,
    base: "",
    since,
  };
  const ownerIds = new Set<string>();
  for await (const row of deps.pager.rows(feed, signal)) {
    ownerIds.add(row[child.parentField] ?? "");
  }
  const bases = new Map<string, string>();
  for (const id of ownerIds) {
    const base = deps.records.baseOf(deps.metadataRoot, id);
    if (base !== undefined) {
      bases.set(id, base);
    }
  }
  const redact = fieldsToRedact(catalog, child.table, "", deps.policy);
  for (const batch of chunks([...bases.keys()], OWNER_BATCH)) {
    const grouper = childGrouper(child.parentField, new Map(bases));
    const listing = {
      table,
      fields: "all" as const,
      kind: "snapshot" as const,
      base: `${child.parentField}IN${batch.join(",")}`,
    };
    for await (const row of deps.pager.rows(listing, signal)) {
      grouper.add(cleaned(row, redact));
    }
    const { attached } = grouper.result();
    for (const id of batch) {
      const base = bases.get(id) ?? "";
      await store(deps, base, child.table, attached.get(base), totals);
    }
  }
}

// Lists a family of child tables again, as a full pull does, and removes the files of owners
// that have no rows left.
async function relistFamily(
  deps: IncrementalDependencies,
  catalog: Catalog,
  family: readonly ChildTable[],
  signal: AbortSignal,
  totals: Totals,
): Promise<string[]> {
  const ownerMap = await owners(deps);
  const unreadable: string[] = [];
  for (const child of family) {
    const grouped = await groupTable(deps, catalog, child, ownerMap, signal);
    if (grouped === null) {
      unreadable.push(child.table);
      continue;
    }
    const holders = new Set<string>();
    for await (const base of deps.records.bases(deps.metadataRoot)) {
      if (deps.records.filesOf(deps.metadataRoot, base).includes(childFile(base, child.table))) {
        holders.add(base);
      }
    }
    for (const base of new Set([...holders, ...grouped.attached.keys()])) {
      await store(deps, base, child.table, grouped.attached.get(base), totals);
    }
  }
  return unreadable;
}

// Families to list again: a nested table resolves owners only through its parent rows, and a
// table with fewer rows lost rows that no change feed reports.
function familiesToRelist(changes: ReadonlyMap<string, FingerprintChange>): ChildTable[][] {
  const roots = new Map<string, ChildTable[]>();
  for (const child of CHILD_TABLES) {
    const change = changes.get(child.table) ?? "unchanged";
    if (change === "shrunk" || (change === "changed" && child.parentTable !== undefined)) {
      const family = childFamily(child.table);
      roots.set(family[0]?.table ?? child.table, family);
    }
  }
  return [...roots.values()];
}

export async function applyChildChanges(
  deps: IncrementalDependencies,
  catalog: Catalog,
  changes: ReadonlyMap<string, FingerprintChange>,
  since: string,
  signal: AbortSignal,
): Promise<ChildOutcome> {
  const totals: Totals = { childFiles: 0, removedChildFiles: 0 };
  const unreadable: string[] = [];
  const families = familiesToRelist(changes);
  const relisted = new Set(families.flat().map((child) => child.table));
  for (const family of families) {
    unreadable.push(...(await relistFamily(deps, catalog, family, signal, totals)));
  }
  for (const child of CHILD_TABLES) {
    if (changes.get(child.table) !== "changed" || relisted.has(child.table)) {
      continue;
    }
    try {
      await refreshOwners(deps, catalog, child, since, signal, totals);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(child.table);
    }
  }
  return { ...totals, unreadable: unreadable.sort() };
}
