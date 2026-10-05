import type { Row } from "../kernel/row";
import type { TableName } from "../kernel/table-name";

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
}

// Read access to one instance. Every implementation goes through the request scheduler.
export interface InstanceReader {
  query(query: TableQuery, signal: AbortSignal): Promise<readonly Row[]>;
  stats(): ConnectionStats;
}
