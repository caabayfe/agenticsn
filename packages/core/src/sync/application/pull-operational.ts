import type { TableStatistics } from "../../connection/ports";
import { AccessDeniedError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { INVENTORY, type InventorySource, inventorySignature } from "../domain/inventory";
import type { PullDependencies } from "./pull-dependencies";

export interface OperationalOutcome {
  readonly operationalRows: number;
  readonly unreadable: readonly string[];
}

// Lists one inventory source into its YAML file; null when the user may not read it.
async function listSource(
  deps: PullDependencies,
  source: InventorySource,
  signal: AbortSignal,
): Promise<number | null> {
  const rows: Row[] = [];
  const fields = source.key === "sys_id" ? source.fields : [...source.fields, "sys_id"];
  const listing = {
    table: TableName.parse(source.table),
    fields,
    kind: "snapshot" as const,
    base: source.base,
  };
  try {
    for await (const row of deps.pager.rows(listing, signal)) {
      rows.push(Object.fromEntries(source.fields.map((field) => [field, row[field] ?? ""])));
    }
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) {
      throw error;
    }
    return null;
  }
  rows.sort((a, b) => ((a[source.key] ?? "") < (b[source.key] ?? "") ? -1 : 1));
  await deps.records.writeDocument(deps.operationalRoot, `${source.file}.yaml`, rows);
  return rows.length;
}

// Plugins, store applications and domains (all of them, or the sources given).
export async function pullOperational(
  deps: PullDependencies,
  signal: AbortSignal,
  sources: readonly InventorySource[] = INVENTORY,
): Promise<OperationalOutcome> {
  let operationalRows = 0;
  const unreadable: string[] = [];
  for (const source of sources) {
    const rows = await listSource(deps, source, signal);
    if (rows === null) {
      unreadable.push(source.table);
    } else {
      operationalRows += rows;
    }
  }
  return { operationalRows, unreadable };
}

// The change signal of every source that has one: file -> signature. One aggregate request
// each; sources the user may not aggregate are left out (and so count as changed).
export async function inventorySignatures(
  statistics: TableStatistics,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const signatures: Record<string, string> = {};
  for (const source of INVENTORY) {
    const table = TableName.parse(source.table);
    try {
      if (source.signal === "active-count") {
        signatures[source.file] = inventorySignature(
          await statistics.countBy(table, "active", signal),
        );
      } else if (source.signal === "fingerprint") {
        const fingerprint = await statistics.fingerprint(table, signal);
        signatures[source.file] = `${fingerprint.count}|${fingerprint.maxUpdatedOn ?? ""}`;
      }
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
    }
  }
  return signatures;
}
