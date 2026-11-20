import type { TableStatistics } from "../../connection/ports";
import { AccessDeniedError } from "../../index-errors";
import { TableName } from "../../kernel/table-name";
import {
  FINGERPRINT_SOURCES,
  latestCredibleUpdate,
  type TableFingerprint,
} from "../domain/fingerprint";
import type { Fingerprints } from "../ports";
import { forEachConcurrently } from "./concurrently";

export interface FingerprintOutcome {
  readonly fingerprints: Fingerprints;
  // Sources the user may not aggregate; they are always treated as changed.
  readonly unreadable: readonly string[];
}

// The table's row count, and its latest update among the rows not dated in the future. A table
// holding such a row costs one more aggregate request; without it, the pull would report the
// instance unchanged whatever was updated since (see latestCredibleUpdate).
async function fingerprintOf(
  statistics: TableStatistics,
  table: TableName,
  clock: () => number | null,
  signal: AbortSignal,
): Promise<TableFingerprint> {
  const whole = await statistics.fingerprint(table, signal);
  const now = clock();
  const upTo = now === null ? null : latestCredibleUpdate(whole, now);
  if (upTo === null) return whole;
  const credible = await statistics.fingerprint(table, signal, upTo);
  return { count: whole.count, maxUpdatedOn: credible.maxUpdatedOn };
}

// One aggregate request per change source (ADR-0016, ASR-16). `clock` is the instance's time
// (epoch ms), read after it has answered; null when it gave none.
export async function fetchFingerprints(
  statistics: TableStatistics,
  signal: AbortSignal,
  clock: () => number | null,
): Promise<FingerprintOutcome> {
  const fingerprints: Record<string, TableFingerprint> = {};
  const unreadable: string[] = [];
  await forEachConcurrently(FINGERPRINT_SOURCES, 4, async (table) => {
    try {
      fingerprints[table] = await fingerprintOf(statistics, TableName.parse(table), clock, signal);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(table);
    }
  });
  return { fingerprints, unreadable: unreadable.sort() };
}
