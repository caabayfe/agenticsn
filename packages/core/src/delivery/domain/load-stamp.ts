import { formatRawTimestamp } from "../../kernel/raw-timestamp";

// What a loaded record carries so the instance stamps it as a write would (ADR-0030): fluent/load
// keeps a record's own sys_mod_count and sys_updated_on unless the update gives them, and pull
// finds changes by those. Found on pdi2: a job loaded without them kept its old update time, and
// the next incremental pull never saw the new script.
export interface LoadStamp {
  readonly modCount: string;
  readonly updatedOn: string;
}

// `pulled` is the record's sys_mod_count as last pulled, or null for a new record.
export const nextModCount = (pulled: string | null) =>
  pulled === null ? "0" : String((Number(pulled) || 0) + 1);

export const loadStamp = (pulled: string | null, now: Date): LoadStamp => ({
  modCount: nextModCount(pulled),
  updatedOn: formatRawTimestamp(now.getTime()),
});
