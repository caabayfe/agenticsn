import { CHILD_TABLES } from "./pull-scope";
import { formatRawTimestamp, parseRawTimestamp } from "./raw-timestamp";

// Count and latest sys_updated_on of a table: inserts and updates raise the latest update,
// deletions lower the count (ADR-0016, M4 appendix).
export interface TableFingerprint {
  readonly count: number;
  readonly maxUpdatedOn: string | null;
}

export type FingerprintChange = "unchanged" | "changed" | "shrunk";

// Every table whose fingerprint decides whether an incremental pull has work to do.
export const FINGERPRINT_SOURCES: readonly string[] = [
  "sys_metadata",
  ...CHILD_TABLES.map((child) => child.table),
];

export function compareFingerprint(
  previous: TableFingerprint | undefined,
  current: TableFingerprint,
): FingerprintChange {
  if (previous === undefined) {
    return "changed";
  }
  if (current.count < previous.count) {
    return "shrunk";
  }
  return current.count === previous.count && current.maxUpdatedOn === previous.maxUpdatedOn
    ? "unchanged"
    : "changed";
}

// Encoded-query timestamps are raw UTC, but a transaction may commit a row with a
// sys_updated_on earlier than the moment it becomes visible: re-reading a window before the
// watermark catches rows that were still in flight (ADR-0016).
export const OVERLAP_MINUTES = 10;

export function changesSince(watermark: string): string {
  return formatRawTimestamp(parseRawTimestamp(watermark) - OVERLAP_MINUTES * 60_000);
}
