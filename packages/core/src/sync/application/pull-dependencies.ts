import type { TableStatistics } from "../../connection/ports";
import type { RedactionPolicy } from "../../metadata/domain/redaction";
import type { MirrorWriter, SyncStateStore } from "../ports";
import type { KeysetPager } from "./keyset-pager";

export interface PullProgress {
  readonly message: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface PullDependencies {
  readonly pager: KeysetPager;
  readonly statistics: TableStatistics;
  readonly records: MirrorWriter;
  readonly state: SyncStateStore;
  // Prefixes inside the mirror: instances/<name>/metadata and instances/<name>/operational.
  readonly metadataRoot: string;
  readonly operationalRoot: string;
  readonly policy: RedactionPolicy;
  readonly now: () => Date;
  // Classes listed at the same time (default 4, the scheduler's maximum, so the scheduler
  // and not this number governs how many requests run at once).
  readonly classConcurrency?: number;
}

// Raw UTC timestamp in ServiceNow's format.
export function rawTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
