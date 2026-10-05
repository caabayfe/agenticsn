import type { TableStatistics } from "../../connection/ports";
import { AccessDeniedError } from "../../index-errors";
import { TableName } from "../../kernel/table-name";
import { FINGERPRINT_SOURCES, type TableFingerprint } from "../domain/fingerprint";
import type { Fingerprints } from "../ports";
import { forEachConcurrently } from "./concurrently";

export interface FingerprintOutcome {
  readonly fingerprints: Fingerprints;
  // Sources the user may not aggregate; they are always treated as changed.
  readonly unreadable: readonly string[];
}

// One aggregate request per change source (ADR-0016, ASR-16).
export async function fetchFingerprints(
  statistics: TableStatistics,
  signal: AbortSignal,
): Promise<FingerprintOutcome> {
  const fingerprints: Record<string, TableFingerprint> = {};
  const unreadable: string[] = [];
  await forEachConcurrently(FINGERPRINT_SOURCES, 4, async (table) => {
    try {
      fingerprints[table] = await statistics.fingerprint(TableName.parse(table), signal);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(table);
    }
  });
  return { fingerprints, unreadable: unreadable.sort() };
}
