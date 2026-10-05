import type { RedactionPolicy } from "../../metadata/domain/redaction";
import type { RecordStore } from "../../metadata/ports";
import type { SyncStateStore } from "../ports";
import type { KeysetPager } from "./keyset-pager";

export interface PullProgress {
  readonly message: string;
  readonly completed?: number;
  readonly total?: number;
}

export interface PullDependencies {
  readonly pager: KeysetPager;
  readonly records: RecordStore;
  readonly state: SyncStateStore;
  // The mirror's metadata folder and operational folder.
  readonly metadataRoot: string;
  readonly operationalRoot: string;
  readonly policy: RedactionPolicy;
  readonly now: () => Date;
  // Classes listed at the same time; the request scheduler still limits HTTP concurrency.
  readonly classConcurrency?: number;
}

// Raw UTC timestamp in ServiceNow's format.
export function rawTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
