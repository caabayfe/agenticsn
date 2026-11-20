import { formatRawTimestamp, parseRawTimestamp } from "../../kernel/raw-timestamp";
import type { TableFingerprint } from "../../kernel/table-fingerprint";
import { CHILD_TABLES } from "./pull-scope";
import { CLOCK_TOLERANCE_MINUTES } from "./pull-state";

export type { TableFingerprint };

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

// A row dated in the future is the table's latest update for ever, so no later change moves the
// fingerprint: sn_na_analytics ships two records dated 2099-01-01, and a pull of pdi15 missed a
// record changed in place minutes before (2026-11-20). Returns the latest moment (raw UTC) a row
// can have been updated by the instance's clock (clocks differ by a little) when the fingerprint's
// own is beyond it, and null when the fingerprint can be compared as it is.
export function latestCredibleUpdate(fingerprint: TableFingerprint, clock: number): string | null {
  const limit = clock + CLOCK_TOLERANCE_MINUTES * 60_000;
  const { maxUpdatedOn } = fingerprint;
  return maxUpdatedOn !== null && parseRawTimestamp(maxUpdatedOn) > limit
    ? formatRawTimestamp(limit)
    : null;
}

// Encoded-query timestamps are raw UTC, but a transaction may commit a row with a
// sys_updated_on earlier than the moment it becomes visible: re-reading a window before the
// watermark catches rows that were still in flight (ADR-0016).
export const OVERLAP_MINUTES = 10;

export function changesSince(watermark: string): string {
  return formatRawTimestamp(parseRawTimestamp(watermark) - OVERLAP_MINUTES * 60_000);
}
