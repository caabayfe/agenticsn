import { AccessDeniedError, InvalidIdentifierError } from "../../index-errors";
import { TableName } from "../../kernel/table-name";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { renderRecord } from "../../metadata/domain/record-layout";
import type { PullCheckpoint } from "../ports";
import { forEachConcurrently } from "./concurrently";
import type { PullDependencies, PullProgress } from "./pull-dependencies";

export interface RecordsOutcome {
  readonly records: number;
  readonly skippedRows: number;
  readonly unreadable: readonly string[];
}

async function pullClass(
  table: string,
  deps: PullDependencies,
  catalog: Catalog,
  signal: AbortSignal,
) {
  let records = 0;
  let skipped = 0;
  // sys_class_name filter: a parent table would return child-class rows without their own fields.
  const listing = {
    table: TableName.parse(table),
    fields: "all" as const,
    kind: "snapshot" as const,
    base: `sys_class_name=${table}`,
  };
  for await (const row of deps.pager.rows(listing, signal)) {
    try {
      await deps.records.write(
        deps.metadataRoot,
        renderRecord(artifactFromRow(row, catalog, deps.policy), catalog),
      );
      records += 1;
    } catch (error) {
      if (!(error instanceof InvalidIdentifierError)) {
        throw error;
      }
      skipped += 1;
    }
  }
  return { records, skipped };
}

export async function pullRecords(
  deps: PullDependencies,
  catalog: Catalog,
  classes: readonly string[],
  checkpoint: PullCheckpoint,
  signal: AbortSignal,
  progress: (event: PullProgress) => void,
): Promise<RecordsOutcome> {
  const completed = [...checkpoint.completedClasses];
  const unreadable: string[] = [];
  let records = checkpoint.records;
  let skippedRows = 0;
  const pending = classes.filter((table) => !completed.includes(table));
  await forEachConcurrently(pending, deps.classConcurrency ?? 4, async (table) => {
    try {
      const outcome = await pullClass(table, deps, catalog, signal);
      records += outcome.records;
      skippedRows += outcome.skipped;
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(table);
    }
    completed.push(table);
    // Git first: the checkpoint must never claim a class the mirror does not hold yet.
    await deps.records.checkpoint();
    await deps.state.writeCheckpoint({ ...checkpoint, completedClasses: completed, records });
    progress({ message: `records: ${table}`, completed: completed.length, total: classes.length });
  });
  return { records, skippedRows, unreadable: unreadable.sort() };
}
