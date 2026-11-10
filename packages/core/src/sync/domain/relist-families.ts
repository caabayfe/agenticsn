import type { FingerprintChange } from "./fingerprint";
import { CHILD_TABLES, type ChildTable, childFamily } from "./pull-scope";

// Families to list again: a nested table resolves owners only through its parent rows (the
// nested families are small: workflow structure), and a table the last pull did not read has
// no rows to refresh from (ADR-0025).
export function familiesToRelist(
  changes: ReadonlyMap<string, FingerprintChange>,
  neverRead: ReadonlySet<string>,
): ChildTable[][] {
  const roots = new Map<string, ChildTable[]>();
  for (const child of CHILD_TABLES) {
    const change = changes.get(child.table) ?? "unchanged";
    const nested = change !== "unchanged" && child.parentTable !== undefined;
    if (nested || neverRead.has(child.table)) {
      const family = childFamily(child.table);
      roots.set(family[0]?.table ?? child.table, family);
    }
  }
  return [...roots.values()];
}
