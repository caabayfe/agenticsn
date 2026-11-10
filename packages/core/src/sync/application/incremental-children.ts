import { AccessDeniedError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { fieldsToRedact } from "../../metadata/domain/redaction";
import {
  type SecretRedaction,
  scanDocumentSecrets,
  sortSecretRedactions,
} from "../../metadata/domain/secret-scan";
import type { FingerprintChange } from "../domain/fingerprint";
import { CHILD_TABLES, type ChildTable } from "../domain/pull-scope";
import { chunks } from "../domain/record-changes";
import { familiesToRelist } from "../domain/relist-families";
import { withUnlistedRows } from "../domain/unlisted-rows";
import { type ChildOwners, childOwners, ownersWithOtherCounts } from "./child-owners";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { cleaned, groupTable, owners } from "./pull-children";

// Parent keys per request when refreshing records' child rows.
const OWNER_BATCH = 100;

export interface ChildOutcome {
  readonly childFiles: number;
  readonly removedChildFiles: number;
  readonly unreadable: readonly string[];
  readonly secretRedactions: readonly SecretRedaction[];
}

interface Totals {
  childFiles: number;
  removedChildFiles: number;
  secretRedactions: SecretRedaction[];
  // sys_ids the instance's deletion records name in this pull.
  deleted: ReadonlySet<string>;
}

const newTotals = (deleted: readonly string[] = []): Totals => ({
  childFiles: 0,
  removedChildFiles: 0,
  secretRedactions: [],
  deleted: new Set(deleted),
});

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
  const held = deps.records.filesOf(deps.metadataRoot, base).includes(path);
  // Another user's listing is not the whole family (ADR-0052 item 4): what it missed stays.
  const current =
    deps.absence === "keep" && held
      ? withUnlistedRows(
          rows ?? [],
          await deps.records.readDocument(deps.metadataRoot, path),
          totals.deleted,
        )
      : (rows ?? []);
  if (current.length > 0) {
    const scanned = scanDocumentSecrets(current);
    await deps.records.writeDocument(deps.metadataRoot, path, scanned.document);
    if (scanned.patterns.length > 0) {
      totals.secretRedactions.push({
        path: `${deps.metadataRoot}/${path}`,
        patterns: scanned.patterns,
      });
    }
    totals.childFiles += 1;
  } else if (held) {
    await deps.records.remove(deps.metadataRoot, path);
    totals.removedChildFiles += 1;
  }
}

// Records whose child rows changed since `since`.
async function changedOwners(
  deps: IncrementalDependencies,
  child: ChildTable,
  owners: ChildOwners,
  since: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  const feed = {
    table: TableName.parse(child.table),
    fields: ["sys_id", "sys_updated_on", child.parentField],
    kind: "change-feed" as const,
    allDomains: true,
    base: "",
    since,
  };
  const bases = new Set<string>();
  for await (const row of deps.pager.rows(feed, signal)) {
    const base = owners.baseOf(row[child.parentField] ?? "");
    if (base !== undefined) {
      bases.add(base);
    }
  }
  return bases;
}

// Records grouped so that each request names at most OWNER_BATCH parent keys; a record with
// more keys than that gets a batch of its own, read in several requests.
function ownerBatches(bases: Iterable<string>, owners: ChildOwners): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let keys = 0;
  for (const base of bases) {
    const count = owners.keysOf(base).length;
    if (current.length > 0 && keys + count > OWNER_BATCH) {
      batches.push(current);
      current = [];
      keys = 0;
    }
    current.push(base);
    keys += count;
  }
  return current.length > 0 ? [...batches, current] : batches;
}

// Reads each record's child rows again whole, so rows deleted from it disappear too. A
// record's file is written only once all of its keys have been read.
async function refreshOwners(
  deps: IncrementalDependencies,
  catalog: Catalog,
  child: ChildTable,
  owners: ChildOwners,
  bases: Iterable<string>,
  signal: AbortSignal,
  totals: Totals,
): Promise<void> {
  const redact = fieldsToRedact(catalog, child.table, {}, deps.policy);
  for (const batch of ownerBatches(bases, owners)) {
    const rows = new Map<string, Row[]>();
    for (const keys of chunks(
      batch.flatMap((base) => owners.keysOf(base)),
      OWNER_BATCH,
    )) {
      const listing = {
        table: TableName.parse(child.table),
        fields: "all" as const,
        kind: "snapshot" as const,
        allDomains: true,
        base: `${child.parentField}IN${keys.join(",")}`,
      };
      for await (const row of deps.pager.rows(listing, signal)) {
        const base = owners.baseOf(row[child.parentField] ?? "");
        if (base !== undefined) {
          const list = rows.get(base) ?? [];
          list.push(cleaned(row, redact));
          rows.set(base, list);
        }
      }
    }
    for (const base of batch) {
      const sorted = (rows.get(base) ?? []).sort((a, b) =>
        (a["sys_id"] ?? "") < (b["sys_id"] ?? "") ? -1 : 1,
      );
      await store(deps, base, child.table, sorted, totals);
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
  const owners = await childOwners(deps, child, signal);
  const bases = await changedOwners(deps, child, owners, since, signal);
  if (change === "shrunk") {
    for (const base of await ownersWithOtherCounts(deps, child, owners, signal)) {
      bases.add(base);
    }
  }
  await refreshOwners(deps, catalog, child, owners, bases, signal, totals);
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

export async function applyChildChanges(
  deps: IncrementalDependencies,
  catalog: Catalog,
  changes: ReadonlyMap<string, FingerprintChange>,
  window: {
    readonly since: string;
    readonly neverRead: ReadonlySet<string>;
    // Records new to the mirror: their rows may be older than they are (spec 006, B4).
    readonly created?: readonly { readonly base: string; readonly className: string }[];
    // sys_ids the instance's deletion records name in this pull.
    readonly deleted?: readonly string[];
  },
  signal: AbortSignal,
): Promise<ChildOutcome> {
  const { since, neverRead, created = [] } = window;
  const totals = newTotals(window.deleted);
  const unreadable: string[] = [];
  const families = familiesToRelist(changes, neverRead);
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
  for (const child of CHILD_TABLES) {
    const owners = created.filter((record) => child.ownerClasses?.includes(record.className));
    if (owners.length > 0 && !relisted.has(child.table)) {
      unreadable.push(...(await readNewOwners(deps, catalog, child, owners, signal, totals)));
    }
  }
  return {
    ...totals,
    unreadable: [...new Set(unreadable)].sort(),
    secretRedactions: sortSecretRedactions(totals.secretRedactions),
  };
}

// The rows of records new to the mirror, read whole whatever their timestamps.
async function readNewOwners(
  deps: IncrementalDependencies,
  catalog: Catalog,
  child: ChildTable,
  created: readonly { readonly base: string }[],
  signal: AbortSignal,
  totals: Totals,
): Promise<string[]> {
  try {
    const owners = await childOwners(deps, child, signal);
    const bases = created.map((record) => record.base);
    await refreshOwners(deps, catalog, child, owners, bases, signal, totals);
    return [];
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) {
      throw error;
    }
    return [child.table];
  }
}
