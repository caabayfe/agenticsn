import type { BuiltUnit } from "../../authoring";
import type { InstanceReader } from "../../connection";
import { KeysetPager } from "../../sync";
import type { PlannedUnit, UnitProblem } from "../domain/unit-plan";
import { unscopedReason, unscopedTables } from "../domain/unscoped-tables";
import { listRows, tableAncestry } from "./table-ancestry";

// Takes out of each project's load the updates and deletions of records whose table has no
// application scope, each one a problem (ADR-0060). Creates stay: the platform accepts them. A
// plan that updates and deletes nothing reads nothing (ADR-0016).

const CHANGES: ReadonlySet<string> = new Set(["load", "delete"]);

async function unscopedOf(reader: InstanceReader, tables: readonly string[], signal: AbortSignal) {
  if (tables.length === 0) return new Set<string>();
  const pager = new KeysetPager(reader);
  const { parents, known } = await tableAncestry(pager, tables, signal);
  const all = [...new Set([...tables, ...parents.values()])];
  const declaring = await listRows(
    pager,
    "sys_dictionary",
    `nameIN${all.join(",")}^element=sys_scope`,
    ["sys_id", "name", "element"],
    signal,
  );
  const scoped = new Set(declaring.map((row) => row["name"] ?? ""));
  return unscopedTables(tables, parents, known, scoped);
}

interface PlannedLoad {
  readonly units: readonly PlannedUnit[];
  readonly built: ReadonlyMap<string, { readonly unit: BuiltUnit }>;
}

export async function withoutUnscopedChanges<L extends PlannedLoad>(
  reader: InstanceReader,
  loads: readonly L[],
  signal: AbortSignal,
): Promise<{ readonly loads: L[]; readonly problems: UnitProblem[] }> {
  const changed = loads.flatMap((load) => load.units.filter((u) => CHANGES.has(u.operation)));
  const unscoped = await unscopedOf(reader, [...new Set(changed.map((u) => u.table))], signal);
  const refused = (unit: PlannedUnit) => CHANGES.has(unit.operation) && unscoped.has(unit.table);
  const problems = changed.filter(refused).map((unit) => ({
    project: unit.project,
    updateName: unit.updateName,
    kind: "unsafe" as const,
    reason: unscopedReason(unit.table),
  }));
  const kept = loads.map((load) => ({ ...load, units: load.units.filter((u) => !refused(u)) }));
  return { loads: kept, problems };
}
