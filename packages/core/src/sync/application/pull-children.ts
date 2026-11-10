import { AccessDeniedError } from "../../index-errors";
import { canonicalText } from "../../kernel/canonical-text";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { fieldsToRedact } from "../../metadata/domain/redaction";
import { type SecretRedaction, sortSecretRedactions } from "../../metadata/domain/secret-scan";
import { CHILD_TABLES, type ChildTable, ownerOfBase, variableModelOf } from "../domain/pull-scope";
import {
  childDocument,
  namedByNestedTable,
  namedThroughChildRows,
  resolveThrough,
  type SpilledChildRow,
  spilledRow,
  type ThroughEntry,
} from "../domain/spilled-children";
import type { KeyedSpill } from "../ports";
import type { PullDependencies } from "./pull-dependencies";

export interface ChildrenOutcome {
  readonly childRows: number;
  readonly orphanChildRows: number;
  readonly unreadable: readonly string[];
  readonly secretRedactions: readonly SecretRedaction[];
}

export function cleaned(row: Row, redact: ReadonlySet<string>): Row {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([field]) => !redact.has(field.toLowerCase()))
      .map(([field, value]) => [field, canonicalText(value)]),
  );
}

export async function owners(deps: PullDependencies): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for await (const base of deps.records.bases(deps.metadataRoot)) {
    map.set(ownerOfBase(base), base);
  }
  return map;
}

// Table name -> the sys_id of its sys_db_object record, in one listing of two fields.
export async function tableIds(
  deps: PullDependencies,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const listing = {
    table: TableName.parse("sys_db_object"),
    fields: ["sys_id", "name"],
    kind: "snapshot" as const,
    base: "",
  };
  const ids = new Map<string, string>();
  for await (const row of deps.pager.rows(listing, signal)) {
    ids.set(row["name"] ?? "", row["sys_id"] ?? "");
  }
  return ids;
}

// Lets rows keyed by table name find their table's record: names and sys_ids never collide.
async function addTableNames(
  deps: PullDependencies,
  owners: Map<string, string>,
  signal: AbortSignal,
): Promise<void> {
  for (const [name, sysId] of await tableIds(deps, signal)) {
    const base = owners.get(sysId);
    if (base !== undefined && name !== "") {
      owners.set(name, base);
    }
  }
}

// The keys a child row's parent field may hold, and the record each belongs to: records, table
// names and rows of nested tables' parents in memory; every other child row's sys_id on disk,
// for the table owned through child rows (null when that table is not listed with them).
export interface ChildRowKeys {
  readonly owners: Map<string, string>;
  readonly through: KeyedSpill<ThroughEntry> | null;
}

export interface ListedChildren {
  // Owner base -> its rows, in listing order.
  readonly spill: KeyedSpill<SpilledChildRow>;
  readonly orphans: number;
}

async function attach(
  child: ChildTable,
  keys: ChildRowKeys,
  spill: KeyedSpill<SpilledChildRow>,
  base: string,
  entry: SpilledChildRow,
): Promise<void> {
  if (namedByNestedTable(child)) {
    keys.owners.set(entry.id, base);
  }
  if (keys.through !== null && namedThroughChildRows(child)) {
    await keys.through.add(entry.id, { kind: "owner", base });
  }
  await spill.add(base, entry);
}

// Joins the rows of a table owned through child rows with the owners of the rows they name.
async function joinThrough(
  through: KeyedSpill<ThroughEntry>,
  owners: ReadonlyMap<string, string>,
  spill: KeyedSpill<SpilledChildRow>,
): Promise<number> {
  let orphans = 0;
  for await (const [key, entries] of through.groups()) {
    const { base, rows } = resolveThrough(entries, owners.get(key));
    if (base === undefined) {
      orphans += rows.length;
      continue;
    }
    for (const row of rows) {
      await spill.add(base, row);
    }
  }
  return orphans;
}

async function spillRows(
  deps: PullDependencies,
  catalog: Catalog,
  child: ChildTable,
  keys: ChildRowKeys,
  spill: KeyedSpill<SpilledChildRow>,
  signal: AbortSignal,
): Promise<number> {
  const redact = fieldsToRedact(catalog, child.table, {}, deps.policy);
  const alias = child.ownedByTableName === true ? variableModelOf : () => null;
  const through = child.ownedThroughChildRows === true ? keys.through : null;
  const listing = {
    table: TableName.parse(child.table),
    fields: "all" as const,
    kind: "snapshot" as const,
    allDomains: true,
    base: "",
  };
  if (child.ownedByTableName === true) {
    await addTableNames(deps, keys.owners, signal);
  }
  let orphans = 0;
  for await (const row of deps.pager.rows(listing, signal)) {
    const clean = cleaned(row, redact);
    const key = clean[child.parentField] ?? "";
    if (through !== null) {
      await through.add(key, { kind: "row", row: spilledRow(clean) });
      continue;
    }
    const base = keys.owners.get(key) ?? keys.owners.get(alias(key) ?? "");
    if (base === undefined) {
      orphans += 1;
    } else {
      await attach(child, keys, spill, base, spilledRow(clean));
    }
  }
  return through === null ? orphans : joinThrough(through, keys.owners, spill);
}

// Lists one child table into a spill grouped by owner, so only a page and one owner's rows are
// ever held (PERF-07). Returns null when the user may not read the table.
export async function listChildTable(
  deps: PullDependencies,
  catalog: Catalog,
  child: ChildTable,
  keys: ChildRowKeys,
  signal: AbortSignal,
): Promise<ListedChildren | null> {
  const spill = await deps.spills.open<SpilledChildRow>();
  try {
    return { spill, orphans: await spillRows(deps, catalog, child, keys, spill, signal) };
  } catch (error) {
    await spill.close();
    if (!(error instanceof AccessDeniedError)) {
      throw error;
    }
    return null;
  }
}

// Each owner's child-row document, as its table's listing completes.
export async function* ownerDocuments(listed: ListedChildren) {
  try {
    for await (const [base, entries] of listed.spill.groups()) {
      yield { base, ...childDocument(entries) };
    }
  } finally {
    await listed.spill.close();
  }
}

// Child rows (flow logic, layouts, workflow structure) live next to their owning record.
export async function pullChildren(
  deps: PullDependencies,
  catalog: Catalog,
  signal: AbortSignal,
): Promise<ChildrenOutcome> {
  const keys = { owners: await owners(deps), through: await deps.spills.open<ThroughEntry>() };
  const unreadable: string[] = [];
  let childRows = 0;
  let orphanChildRows = 0;
  const secretRedactions: SecretRedaction[] = [];
  try {
    for (const child of CHILD_TABLES) {
      const listed = await listChildTable(deps, catalog, child, keys, signal);
      if (listed === null) {
        unreadable.push(child.table);
        continue;
      }
      for await (const { base, rows, patterns } of ownerDocuments(listed)) {
        const relative = `${base}.children.${child.table}.yaml`;
        await deps.records.writeDocument(deps.metadataRoot, relative, rows);
        if (patterns.length > 0) {
          secretRedactions.push({ path: `${deps.metadataRoot}/${relative}`, patterns });
        }
        childRows += rows.length;
      }
      orphanChildRows += listed.orphans;
    }
  } finally {
    await keys.through.close();
  }
  return {
    childRows,
    orphanChildRows,
    unreadable,
    secretRedactions: sortSecretRedactions(secretRedactions),
  };
}
