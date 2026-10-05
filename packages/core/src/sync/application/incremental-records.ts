import { AccessDeniedError, InvalidIdentifierError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { renderRecord } from "../../metadata/domain/record-layout";
import { classesToPull } from "../domain/pull-scope";
import { chunks, isChildRowFile, type RecordChanges } from "../domain/record-changes";
import { forEachConcurrently } from "./concurrently";
import type { IncrementalDependencies } from "./incremental-dependencies";

// sys_ids per download request: keeps the URL short and the page within the size target.
const DOWNLOAD_BATCH = 100;

export interface RecordOutcome {
  readonly written: number;
  readonly renamed: number;
  readonly deleted: number;
  readonly skippedRows: number;
  readonly unreadable: readonly string[];
}

const SYS_METADATA = TableName.parse("sys_metadata");
const SYS_METADATA_DELETE = TableName.parse("sys_metadata_delete");

// The change feed and the delete feed since `since` (ADR-0016): identities only, no content.
export async function readRecordChanges(
  deps: IncrementalDependencies,
  since: string,
  signal: AbortSignal,
): Promise<RecordChanges> {
  const changed = new Map<string, string[]>();
  const scopes = new Set<string>();
  const feed = {
    table: SYS_METADATA,
    fields: ["sys_id", "sys_updated_on", "sys_class_name", "sys_scope"],
    kind: "change-feed" as const,
    base: "",
    since,
  };
  for await (const row of deps.pager.rows(feed, signal)) {
    const table = row["sys_class_name"] ?? "";
    changed.set(table, [...(changed.get(table) ?? []), row["sys_id"] ?? ""]);
    scopes.add(row["sys_scope"] ?? "");
  }
  const deletions = {
    ...feed,
    table: SYS_METADATA_DELETE,
    fields: ["sys_id", "sys_updated_on", "sys_metadata"],
  };
  const deleted: string[] = [];
  for await (const row of deps.pager.rows(deletions, signal)) {
    deleted.push(row["sys_metadata"] ?? "");
  }
  return { changed, scopes, deleted };
}

// Writes a changed record over its previous version: its own files are replaced and its
// child-row files follow it when a new name moves it to a new base.
async function replaceRecord(
  deps: IncrementalDependencies,
  catalog: Catalog,
  row: Row,
): Promise<"written" | "renamed"> {
  const rendered = renderRecord(artifactFromRow(row, catalog, deps.policy), catalog);
  const root = deps.metadataRoot;
  const previous = deps.records.baseOf(root, row["sys_id"] ?? "");
  for (const path of previous === undefined ? [] : deps.records.filesOf(root, previous)) {
    if (!isChildRowFile(previous ?? "", path)) {
      await deps.records.remove(root, path);
    } else if (previous !== rendered.base) {
      await deps.records.move(root, path, rendered.base + path.slice((previous ?? "").length));
    }
  }
  await deps.records.write(root, rendered);
  return previous === undefined || previous === rendered.base ? "written" : "renamed";
}

async function downloadClass(
  deps: IncrementalDependencies,
  catalog: Catalog,
  table: string,
  ids: readonly string[],
  signal: AbortSignal,
) {
  const outcome = { written: 0, renamed: 0, skipped: 0, received: [] as string[] };
  for (const batch of chunks(ids, DOWNLOAD_BATCH)) {
    const listing = {
      table: TableName.parse(table),
      fields: "all" as const,
      kind: "snapshot" as const,
      base: `sys_class_name=${table}^sys_idIN${batch.join(",")}`,
    };
    for await (const row of deps.pager.rows(listing, signal)) {
      outcome.received.push(row["sys_id"] ?? "");
      try {
        outcome[await replaceRecord(deps, catalog, row)] += 1;
      } catch (error) {
        if (!(error instanceof InvalidIdentifierError)) {
          throw error;
        }
        outcome.skipped += 1;
      }
    }
  }
  return outcome;
}

async function removeRecord(deps: IncrementalDependencies, sysId: string): Promise<boolean> {
  const base = deps.records.baseOf(deps.metadataRoot, sysId);
  for (const path of base === undefined ? [] : deps.records.filesOf(deps.metadataRoot, base)) {
    await deps.records.remove(deps.metadataRoot, path);
  }
  return base !== undefined;
}

// Downloads the changed records of every class a pull mirrors, then removes deleted ones.
// A record deleted and created again with the same sys_id is kept.
export async function applyRecordChanges(
  deps: IncrementalDependencies,
  catalog: Catalog,
  changes: RecordChanges,
  signal: AbortSignal,
): Promise<RecordOutcome> {
  const mirrored = new Set(classesToPull(catalog));
  const received = new Set<string>();
  const unreadable: string[] = [];
  const totals = { written: 0, renamed: 0, deleted: 0, skippedRows: 0 };
  const classes = [...changes.changed.keys()].filter((table) => mirrored.has(table)).sort();
  await forEachConcurrently(classes, deps.classConcurrency ?? 4, async (table) => {
    try {
      const ids = changes.changed.get(table) ?? [];
      const outcome = await downloadClass(deps, catalog, table, ids, signal);
      totals.written += outcome.written;
      totals.renamed += outcome.renamed;
      totals.skippedRows += outcome.skipped;
      for (const id of outcome.received) {
        received.add(id);
      }
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(table);
    }
  });
  for (const sysId of changes.deleted) {
    if (!received.has(sysId) && (await removeRecord(deps, sysId))) {
      totals.deleted += 1;
    }
  }
  return { ...totals, unreadable: unreadable.sort() };
}
