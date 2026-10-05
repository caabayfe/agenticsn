import { AccessDeniedError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { fieldsToRedact } from "../../metadata/domain/redaction";
import type { FingerprintChange } from "../domain/fingerprint";
import {
  CHILD_TABLES,
  type ChildTable,
  childFamily,
  childGrouper,
  ownerOfBase,
} from "../domain/pull-scope";
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

// Owners (sys_id -> record base) whose rows changed since `since`.
async function changedOwners(
  deps: IncrementalDependencies,
  child: ChildTable,
  since: string,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const feed = {
    table: TableName.parse(child.table),
    fields: ["sys_id", "sys_updated_on", child.parentField],
    kind: "change-feed" as const,
    base: "",
    since,
  };
  const owners = new Map<string, string>();
  for await (const row of deps.pager.rows(feed, signal)) {
    const id = row[child.parentField] ?? "";
    const base = deps.records.baseOf(deps.metadataRoot, id);
    if (base !== undefined) {
      owners.set(id, base);
    }
  }
  return owners;
}

// Owners whose mirrored row count differs from the instance's: deleted rows appear in no
// change feed, but one grouped count finds the owners that lost them.
async function ownersWithOtherCounts(
  deps: IncrementalDependencies,
  child: ChildTable,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const table = TableName.parse(child.table);
  const current = await deps.statistics.countBy(table, child.parentField, signal);
  const mirrored = await deps.records.countChildRows(deps.metadataRoot, child.table);
  const owners = new Map<string, string>();
  for (const [base, count] of mirrored) {
    const id = ownerOfBase(base);
    if ((current.get(id) ?? 0) !== count) {
      owners.set(id, base);
    }
  }
  for (const id of current.keys()) {
    const base = deps.records.baseOf(deps.metadataRoot, id);
    if (base !== undefined && !mirrored.has(base)) {
      owners.set(id, base);
    }
  }
  return owners;
}

// Reads each owner's rows again whole, so rows deleted from an owner disappear too.
async function refreshOwners(
  deps: IncrementalDependencies,
  catalog: Catalog,
  child: ChildTable,
  owners: ReadonlyMap<string, string>,
  signal: AbortSignal,
  totals: Totals,
): Promise<void> {
  const redact = fieldsToRedact(catalog, child.table, "", deps.policy);
  for (const batch of chunks([...owners.keys()], OWNER_BATCH)) {
    const grouper = childGrouper(child.parentField, new Map(owners));
    const listing = {
      table: TableName.parse(child.table),
      fields: "all" as const,
      kind: "snapshot" as const,
      base: `${child.parentField}IN${batch.join(",")}`,
    };
    for await (const row of deps.pager.rows(listing, signal)) {
      grouper.add(cleaned(row, redact));
    }
    const { attached } = grouper.result();
    for (const id of batch) {
      const base = owners.get(id) ?? "";
      await store(deps, base, child.table, attached.get(base), totals);
    }
  }
}

async function refreshTable(
  deps: IncrementalDependencies,
  catalog: Catalog,
  child: ChildTable,
  change: FingerprintChange,
  since: string,
  signal: AbortSignal,
  totals: Totals,
): Promise<void> {
  const owners = await changedOwners(deps, child, since, signal);
  if (change === "shrunk") {
    for (const [id, base] of await ownersWithOtherCounts(deps, child, signal)) {
      owners.set(id, base);
    }
  }
  await refreshOwners(deps, catalog, child, owners, signal, totals);
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

// Families to list again: a nested table resolves owners only through its parent rows. The
// nested families are small (workflow structure).
function familiesToRelist(changes: ReadonlyMap<string, FingerprintChange>): ChildTable[][] {
  const roots = new Map<string, ChildTable[]>();
  for (const child of CHILD_TABLES) {
    const change = changes.get(child.table) ?? "unchanged";
    if (change !== "unchanged" && child.parentTable !== undefined) {
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
    const change = changes.get(child.table) ?? "unchanged";
    if (change === "unchanged" || relisted.has(child.table)) {
      continue;
    }
    try {
      await refreshTable(deps, catalog, child, change, since, signal, totals);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(child.table);
    }
  }
  return { ...totals, unreadable: unreadable.sort() };
}
