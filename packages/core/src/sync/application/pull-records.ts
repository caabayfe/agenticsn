import { AccessDeniedError, InvalidIdentifierError } from "../../index-errors";
import { TableName } from "../../kernel/table-name";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { renderRecord } from "../../metadata/domain/record-layout";
import { propertyValueVerdict } from "../../metadata/domain/redaction";
import { type SecretRedaction, sortSecretRedactions } from "../../metadata/domain/secret-scan";
import type { PullCheckpoint } from "../ports";
import { forEachConcurrently } from "./concurrently";
import type { PullDependencies, PullProgress } from "./pull-dependencies";

export interface RecordsOutcome {
  readonly records: number;
  readonly skippedRows: number;
  // Property values redacted because they don't have their type's shape (ADR-0034).
  readonly malformedValues: number;
  readonly unreadable: readonly string[];
  readonly secretRedactions: readonly SecretRedaction[];
}

// Lists one class whole and writes its records.
export async function pullClass(
  table: string,
  deps: PullDependencies,
  catalog: Catalog,
  signal: AbortSignal,
) {
  let records = 0;
  let skipped = 0;
  let malformed = 0;
  const secretRedactions: SecretRedaction[] = [];
  // sys_class_name filter: a parent table would return child-class rows without their own fields.
  const listing = {
    table: TableName.parse(table),
    fields: "all" as const,
    kind: "snapshot" as const,
    allDomains: true,
    base: `sys_class_name=${table}`,
  };
  for await (const row of deps.pager.rows(listing, signal)) {
    if (table === "sys_properties" && propertyValueVerdict(row, deps.policy) === "malformed") {
      malformed += 1;
    }
    try {
      const rendered = renderRecord(artifactFromRow(row, catalog, deps.policy), catalog);
      await deps.records.write(deps.metadataRoot, rendered);
      if (rendered.secretPatterns.length > 0) {
        secretRedactions.push({
          path: `${deps.metadataRoot}/${rendered.base}.yaml`,
          patterns: rendered.secretPatterns,
        });
      }
      records += 1;
    } catch (error) {
      if (!(error instanceof InvalidIdentifierError)) {
        throw error;
      }
      skipped += 1;
    }
  }
  return { records, skipped, malformed, secretRedactions };
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
  let malformedValues = 0;
  const secretRedactions = [...(checkpoint.secretRedactions ?? [])];
  const pending = classes.filter((table) => !completed.includes(table));
  await forEachConcurrently(pending, deps.classConcurrency ?? 4, async (table) => {
    try {
      const outcome = await pullClass(table, deps, catalog, signal);
      records += outcome.records;
      skippedRows += outcome.skipped;
      malformedValues += outcome.malformed;
      secretRedactions.push(...outcome.secretRedactions);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(table);
    }
    completed.push(table);
    // Git first: the checkpoint must never claim a class the mirror does not hold yet.
    await deps.records.checkpoint();
    const redactions = sortSecretRedactions(secretRedactions);
    await deps.state.writeCheckpoint({
      ...checkpoint,
      completedClasses: completed,
      records,
      ...(redactions.length > 0 ? { secretRedactions: redactions } : {}),
    });
    progress({ message: `records: ${table}`, completed: completed.length, total: classes.length });
  });
  return {
    records,
    skippedRows,
    malformedValues,
    unreadable: unreadable.sort(),
    secretRedactions: sortSecretRedactions(secretRedactions),
  };
}
