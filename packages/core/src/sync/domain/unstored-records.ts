import type { RecordChanges } from "./record-changes";

// A record the change feed named and its own table did not return: a read ACL or the domain
// hides it from this user there, or it left the instance after the feed was read.
export interface UnreturnedRecord {
  readonly table: string;
  readonly sysId: string;
}

export interface UnstoredRecord extends UnreturnedRecord {
  // The mirror holds the record as it was before the change.
  readonly inMirror: boolean;
}

// What a pull reports of them: every one counted, the first few named.
export interface UnstoredRecords {
  readonly count: number;
  readonly inMirror: number;
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
  unreturned: readonly UnreturnedRecord[],
  inMirror: (sysId: string) => boolean,
): UnstoredRecord[] {
  return unreturned.map((record) => ({ ...record, inMirror: inMirror(record.sysId) }));
}

export function unstoredReport(records: readonly UnstoredRecord[]): UnstoredRecords {
  return {
    count: records.length,
    inMirror: records.filter((record) => record.inMirror).length,
    records: records.slice(0, UNSTORED_SHOWN),
  };
}
