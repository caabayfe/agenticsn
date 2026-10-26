import type { TableStatistics } from "../../connection/ports";
import { AccessDeniedError, InstanceError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import {
  type SecretRedaction,
  scanDocumentSecrets,
  sortSecretRedactions,
} from "../../metadata/domain/secret-scan";
import { INVENTORY, type InventorySource, inventorySignature } from "../domain/inventory";
import type { PullDependencies } from "./pull-dependencies";

export interface OperationalOutcome {
  readonly operationalRows: number;
  readonly unreadable: readonly string[];
  readonly secretRedactions: readonly SecretRedaction[];
}

interface ListedSource {
  readonly rows: number;
  readonly secretRedaction: SecretRedaction | null;
}

// Lists one inventory source into its YAML file; null when the user may not read it.
// A source whose table the instance doesn't have is written empty, without asking.
async function listSource(
  deps: PullDependencies,
  catalog: Catalog,
  source: InventorySource,
  signal: AbortSignal,
): Promise<ListedSource | null> {
  const rows: Row[] = [];
  const relative = `${source.file}.yaml`;
  if (source.optional === true && !catalog.knowsClass(source.table)) {
    await deps.records.writeDocument(deps.operationalRoot, relative, rows);
    return { rows: 0, secretRedaction: null };
  }
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
  const scanned = scanDocumentSecrets(rows);
  await deps.records.writeDocument(deps.operationalRoot, relative, scanned.document);
  return {
    rows: rows.length,
    secretRedaction:
      scanned.patterns.length === 0
        ? null
        : { path: `${deps.operationalRoot}/${relative}`, patterns: scanned.patterns },
  };
}

// Plugins, store applications and domains (all of them, or the sources given).
export async function pullOperational(
  deps: PullDependencies,
  catalog: Catalog,
  signal: AbortSignal,
  sources: readonly InventorySource[] = INVENTORY,
): Promise<OperationalOutcome> {
  let operationalRows = 0;
  const unreadable: string[] = [];
  const secretRedactions: SecretRedaction[] = [];
  for (const source of sources) {
    const rows = await listSource(deps, catalog, source, signal);
    if (rows === null) {
      unreadable.push(source.table);
    } else {
      operationalRows += rows.rows;
      if (rows.secretRedaction !== null) secretRedactions.push(rows.secretRedaction);
    }
  }
  return {
    operationalRows,
    unreadable,
    secretRedactions: sortSecretRedactions(secretRedactions),
  };
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
      // A source the user may not read, or whose signal timed out on a busy instance, has no
      // signature this time: it counts as unchanged and is checked again next pull.
      if (!(error instanceof AccessDeniedError) && !(error instanceof InstanceError)) {
        throw error;
      }
    }
  }
  return signatures;
}
