import type { Row } from "../kernel/row";
import type { TableName } from "../kernel/table-name";
import type { TableFingerprint } from "../sync/domain/fingerprint";

export type { Row } from "../kernel/row";

export interface TableQuery {
  readonly table: TableName;
  // Encoded query; filter on indexed fields only (ADR-0016).
  readonly query: string;
  // Listings and inventories always name their fields. "all" is only for downloading
  // records that are about to be written, which need every field (ADR-0016).
  readonly fields: readonly string[] | "all";
  readonly limit: number;
}

export interface ConnectionStats {
  readonly requests: number;
  readonly retries: number;
  readonly semaphoreWaitMs: number;
  readonly transactionIds: readonly string[];
  readonly concurrencyLimit: number;
  // The highest concurrency the adaptive controller allowed during the run.
  readonly peakConcurrency: number;
  // Total time spent waiting for responses (requests overlap, so this exceeds wall time).
  readonly requestMs: number;
}

// Read access to one instance. Every implementation goes through the request scheduler.
export interface InstanceReader {
  query(query: TableQuery, signal: AbortSignal): Promise<readonly Row[]>;
  stats(): ConnectionStats;
}

// One aggregate request per table: its row count and latest update (ADR-0016, M4 appendix).
export interface TableStatistics {
  fingerprint(table: TableName, signal: AbortSignal): Promise<TableFingerprint>;
  // Row count per value of `field`, in one aggregate request.
  countBy(
    table: TableName,
    field: string,
    signal: AbortSignal,
    query?: string,
  ): Promise<ReadonlyMap<string, number>>;
  // Rows matching an encoded query (indexed fields only), in one aggregate request.
  count(table: TableName, query: string, signal: AbortSignal): Promise<number>;
}
