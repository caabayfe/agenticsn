// fluent/load creates a record of a table with no application scope (no sys_scope column in its
// ancestry, such as cmn_schedule_span), and refuses to update or delete one: "Found <file>.xml
// with invalid scope." (pdi15, 2026-11-28, ADR-0060). Such records change as data.

type Scope = "scoped" | "unscoped" | "unknown";

// Follows a table's ancestry to the first table that declares sys_scope, or to its root.
function scopeOf(
  table: string,
  parents: ReadonlyMap<string, string>,
  known: ReadonlySet<string>,
  scoped: ReadonlySet<string>,
): Scope {
  const seen = new Set<string>();
  for (let at: string | undefined = table; at !== undefined; at = parents.get(at)) {
    if (scoped.has(at)) return "scoped";
    if (!known.has(at) || seen.has(at)) return "unknown";
    seen.add(at);
  }
  return "unscoped";
}

// The tables whose whole ancestry the instance describes, none of it declaring sys_scope. A table
// it does not describe, or whose ancestry it does not fully name, is left to the load: only
// complete evidence refuses.
export function unscopedTables(
  tables: readonly string[],
  parents: ReadonlyMap<string, string>,
  known: ReadonlySet<string>,
  scoped: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set(tables.filter((table) => scopeOf(table, parents, known, scoped) === "unscoped"));
}

export function unscopedReason(table: string): string {
  return (
    `${table} has no application scope: the platform refuses to update or delete its records ` +
    "through a load; change them as data (an accelerator data entity), not as source"
  );
}
