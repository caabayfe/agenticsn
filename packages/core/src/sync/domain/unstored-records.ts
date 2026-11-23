import type { RecordChanges } from "./record-changes";

// A record the change feed named and its own table did not return: a read ACL or the domain
// hides it from this user there, or it left the instance after the feed was read.
export interface UnreturnedRecord {
  readonly table: string;
  readonly sysId: string;
}

// Why a record is not stored, as far as the instance's answers say:
// - not-returned: its table did not return it to the pull that found the change (not asked again);
// - hidden: pull --verify asked again; sys_metadata lists it and its own table does not return it;
// - table-unreadable: pull --verify asked again; its table refuses this user;
// - not-listed: pull --verify asked again; sys_metadata no longer lists it for this user, which
//   a deleted record and one hidden there too have in common.
export const UNSTORED_REASONS = [
  "not-returned",
  "hidden",
  "table-unreadable",
  "not-listed",
] as const;
export type UnstoredReason = (typeof UNSTORED_REASONS)[number];

export interface ExplainedRecord extends UnreturnedRecord {
  readonly reason: UnstoredReason;
}

export interface UnstoredRecord extends ExplainedRecord {
  // The mirror holds the record as it was before the change.
  readonly inMirror: boolean;
}

// What a pull reports of them: every one counted, the first few named.
export interface UnstoredRecords {
  readonly count: number;
  readonly inMirror: number;
  // Records of earlier pulls that pull --verify read again and stored.
  readonly recovered: number;
  readonly records: readonly UnstoredRecord[];
}

export const UNSTORED_SHOWN = 20;

// Left out, because the pull reports them another way or never mirrors them: classes it does not
// pull, classes it could not read (named as unreadable), rows it received and skipped (counted
// as skipped) and records a deletion record explains (removed from the mirror).
export function unreturnedRecords(
  changes: RecordChanges,
  read: {
    readonly classes: readonly string[];
    readonly unreadable: readonly string[];
    readonly received: ReadonlySet<string>;
  },
): UnreturnedRecord[] {
  const deleted = new Set(changes.deleted);
  return read.classes
    .filter((table) => !read.unreadable.includes(table))
    .sort()
    .flatMap((table) =>
      [...(changes.changed.get(table) ?? [])]
        .filter((sysId) => !read.received.has(sysId) && !deleted.has(sysId))
        .sort()
        .map((sysId) => ({ table, sysId })),
    );
}

export function markInMirror(
  records: readonly ExplainedRecord[],
  inMirror: (sysId: string) => boolean,
): UnstoredRecord[] {
  return records.map((record) => ({ ...record, inMirror: inMirror(record.sysId) }));
}

export function unstoredReport(records: readonly UnstoredRecord[], recovered = 0): UnstoredRecords {
  return {
    count: records.length,
    inMirror: records.filter((record) => record.inMirror).length,
    recovered,
    records: records.slice(0, UNSTORED_SHOWN),
  };
}

const identity = ({ table, sysId }: UnreturnedRecord): UnreturnedRecord => ({ table, sysId });

export function sortUnstored(records: readonly UnreturnedRecord[]): UnreturnedRecord[] {
  const key = (record: UnreturnedRecord) => `${record.table} ${record.sysId}`;
  // By code unit, so the committed state does not depend on a locale.
  return records.map(identity).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

// The records the pull state carries as unstored after a pull (ADR-0052): those of earlier
// pulls, less the ones this pull received or its deletion feed named, and this pull's own.
export function carryUnstored(
  earlier: readonly UnreturnedRecord[],
  pull: {
    readonly returned: readonly string[];
    readonly deleted: readonly string[];
    readonly unreturned: readonly UnreturnedRecord[];
  },
): UnreturnedRecord[] {
  const settled = new Set([...pull.returned, ...pull.deleted]);
  const again = new Set(pull.unreturned.map((record) => record.sysId));
  const kept = earlier.filter((record) => !settled.has(record.sysId) && !again.has(record.sysId));
  return sortUnstored([...kept, ...pull.unreturned]);
}

// What a targeted re-read found for the records it asked for again.
export function explainReread(
  asked: readonly UnreturnedRecord[],
  answer: {
    // sys_id -> the class sys_metadata gives the record now.
    readonly listed: ReadonlyMap<string, string>;
    readonly mirrored: ReadonlySet<string>;
    readonly unreadable: readonly string[];
    readonly returned: ReadonlySet<string>;
  },
): ExplainedRecord[] {
  return asked.flatMap((record): ExplainedRecord[] => {
    const table = answer.listed.get(record.sysId);
    if (table === undefined) return [{ ...record, reason: "not-listed" }];
    // A class a pull never mirrors is not a record the mirror lacks.
    if (!answer.mirrored.has(table) || answer.returned.has(record.sysId)) return [];
    const reason = answer.unreadable.includes(table) ? "table-unreadable" : "hidden";
    return [{ table, sysId: record.sysId, reason }];
  });
}
