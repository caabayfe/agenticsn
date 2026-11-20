import type { TableStatistics } from "../../connection/ports";
import { formatRawTimestamp } from "../../kernel/raw-timestamp";
import type { RedactionPolicy } from "../../metadata/domain/redaction";
import type { MirrorWriter, PullStateStore, SpillStore } from "../ports";
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
  readonly state: PullStateStore;
  // Where child rows wait, grouped by owner, until their table is listed.
  readonly spills: SpillStore;
  // Prefixes inside the mirror and local state.
  readonly instanceRoot: string;
  readonly metadataRoot: string;
  readonly operationalRoot: string;
  readonly catalogPath: string;
  readonly policy: RedactionPolicy;
  readonly now: () => Date;
  // The instance's clock (epoch ms) once it has answered; null when unknown (ADR-0052 item 7).
  readonly instanceTime?: () => number | null;
  // Classes listed at the same time (default 4, the scheduler's maximum, so the scheduler
  // and not this number governs how many requests run at once).
  readonly classConcurrency?: number;
}

// The instance's clock; null until it has answered with one. Never this machine's, which says
// nothing about what the instance can have dated.
export const instanceClock = (deps: Pick<PullDependencies, "instanceTime">) => () =>
  deps.instanceTime?.() ?? null;

// Raw UTC timestamp in ServiceNow's format.
export function rawTimestamp(date: Date): string {
  return formatRawTimestamp(date.getTime());
}
