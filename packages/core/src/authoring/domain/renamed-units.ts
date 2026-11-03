import type { LedgerEntry } from "./ledger";
import type { BuiltUnit, InstanceCopy } from "./unit";
import { unitSpec } from "./unit-specs";
import { stamp } from "./unit-version";

// SDK 4.14 builds a related list and its entries as one unit, which 4.13 built as one unit per
// record, named by table and sys_id (ADR-0046 item 4). A workspace delivered with 4.13 holds
// those names in its ledger.

const SYS_ID = /^[0-9a-f]{32}$/;
const recordName = (table: string, sysId: string) => `${table}_${sysId}`;

// The names an earlier build gave the records a built unit now carries, other than its own.
export function carriedNames(units: readonly BuiltUnit[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const unit of units) {
    for (const record of [unit.head, ...unit.children]) {
      const name = recordName(record.table, record.sysId);
      if (SYS_ID.test(record.sysId) && name !== unit.updateName) names.add(name);
    }
  }
  return names;
}

// The related lists that built entries name: a list ensure rules stopped restating stays, as
// deleting it would orphan them.
export function namedLists(units: readonly BuiltUnit[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const unit of units) {
    const list = unit.head.fields["list_id"] ?? "";
    if (unit.head.table === "sys_ui_related_list_entry" && SYS_ID.test(list)) {
      names.add(recordName("sys_ui_related_list", list));
    }
  }
  return names;
}

// A whole unit the ledger knew only by its records' earlier names is adopted when the ledger held
// its head and every row the instance has, each unchanged since. A row the ledger never held is
// someone else's: loading the unit whole would remove it, so the unit stays not adopted.
function adoptedParts(
  unit: BuiltUnit,
  copy: InstanceCopy,
  entries: ReadonlyMap<string, LedgerEntry>,
): LedgerEntry | undefined {
  const rows = unitSpec(unit.head.table).children;
  if (rows === undefined) return undefined;
  const parts = [
    { table: unit.head.table, fields: copy.head },
    ...copy.children.map((fields) => ({ table: rows.table, fields })),
  ];
  const held = parts.every(({ table, fields }) => {
    const entry = entries.get(recordName(table, fields["sys_id"] ?? ""));
    return entry !== undefined && entry.instance === stamp(fields);
  });
  return held ? { build: "", instance: copy.version, losses: [] } : undefined;
}

// A unit's ledger entry: its own, or the one its records' earlier names make up.
export function ledgerEntryOf(
  unit: BuiltUnit,
  copy: InstanceCopy | null,
  entries: ReadonlyMap<string, LedgerEntry>,
): LedgerEntry | undefined {
  const own = entries.get(unit.updateName);
  if (own !== undefined || copy === null) return own;
  return adoptedParts(unit, copy, entries);
}
