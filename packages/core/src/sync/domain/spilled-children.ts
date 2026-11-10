import type { Row } from "../../kernel/row";
import {
  mergeSecretPatterns,
  type SecretPatternId,
  scanRowSecrets,
} from "../../metadata/domain/secret-scan";
import { CHILD_TABLES, type ChildTable } from "./pull-scope";

// A child row waiting on disk for the rest of its owner's rows: cleaned and secret-scanned,
// with the sys_id it sorts by and the patterns its scan redacted.
export interface SpilledChildRow {
  readonly id: string;
  readonly row: Row;
  readonly patterns: readonly SecretPatternId[];
}

// What a table owned through other child rows is joined on, keyed by a parent key: the record
// owning an earlier child row with that sys_id, or a row naming that key.
export type ThroughEntry =
  | { readonly kind: "owner"; readonly base: string }
  | { readonly kind: "row"; readonly row: SpilledChildRow };

export function spilledRow(cleaned: Row): SpilledChildRow {
  const scanned = scanRowSecrets(cleaned);
  return { id: cleaned["sys_id"] ?? "", row: scanned.row, patterns: scanned.patterns };
}

// Rows of these tables are named directly by a nested table (workflow structure, which is
// small), so their sys_ids are kept in memory while the family is listed.
export function namedByNestedTable(child: ChildTable): boolean {
  return CHILD_TABLES.some((other) => other.parentTable === child.table);
}

// A later table may name a row of this one through any child row (sys_variable_value), so
// this table's sys_ids are spilled for the join instead of held in memory.
export function namedThroughChildRows(child: ChildTable): boolean {
  return CHILD_TABLES.slice(CHILD_TABLES.indexOf(child) + 1).some(
    (later) => later.ownedThroughChildRows === true,
  );
}

// One parent key's join group, in the order it was spilled: as when every child row's sys_id
// was added to one owner map, the last child row with that sys_id names the owner; without
// one, `direct` (the record or table the key names) does.
export function resolveThrough(
  entries: readonly ThroughEntry[],
  direct: string | undefined,
): { readonly base: string | undefined; readonly rows: readonly SpilledChildRow[] } {
  let base: string | undefined;
  const rows: SpilledChildRow[] = [];
  for (const entry of entries) {
    if (entry.kind === "owner") {
      base = entry.base;
    } else {
      rows.push(entry.row);
    }
  }
  return { base: base ?? direct, rows };
}

// An owner's child-row file: its rows sorted by sys_id, and the patterns their scans redacted.
export function childDocument(entries: readonly SpilledChildRow[]): {
  readonly rows: readonly Row[];
  readonly patterns: readonly SecretPatternId[];
} {
  const sorted = entries.toSorted((a, b) => (a.id < b.id ? -1 : 1));
  return {
    rows: sorted.map((entry) => entry.row),
    patterns: mergeSecretPatterns(sorted.map((entry) => entry.patterns)),
  };
}
