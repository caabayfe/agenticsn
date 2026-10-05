import type { TableName } from "../kernel/table-name";

// With raw values and no reference links, every field arrives as a string.
export type Row = Readonly<Record<string, string>>;

export interface TableQuery {
  readonly table: TableName;
  // Encoded query; filter on indexed fields only (ADR-0016).
  readonly query: string;
  // Always explicit: never "all fields".
  readonly fields: readonly string[];
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
