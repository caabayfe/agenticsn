import type { Catalog } from "../../metadata/domain/catalog";
import { CHILD_TABLES, type ChildTable } from "../../metadata/domain/child-tables";
import { isDeniedClass } from "../../metadata/domain/field-rules";

export {
  CHILD_TABLES,
  type ChildTable,
} from "../../metadata/domain/child-tables";

// Derived copies and translations: large and reproducible from other records (ADR-0017).
const DERIVED_CLASSES = new Set([
  "sys_documentation",
  "sys_translated",
  "sys_hub_flow_snapshot",
  "sys_hub_action_type_snapshot",
]);

export function classesToPull(catalog: Catalog): string[] {
  return catalog
    .metadataClasses()
    .filter((table) => !isDeniedClass(catalog, table) && !DERIVED_CLASSES.has(table));
}

function rootOf(child: ChildTable): string {
  const parent = CHILD_TABLES.find((other) => other.table === child.parentTable);
  return parent === undefined ? child.table : rootOf(parent);
}

// A child table together with the tables nested under it: nested rows find their owner only
// through their parent rows, so the family is listed together.
export function childFamily(table: string): ChildTable[] {
  const child = CHILD_TABLES.find((candidate) => candidate.table === table);
  if (child === undefined) {
    return [];
  }
  const root = rootOf(child);
  return CHILD_TABLES.filter((candidate) => rootOf(candidate) === root);
}

// A record path ends in <slug>--<sys_id>; slugs never contain "--".
export function ownerOfBase(base: string): string {
  const leaf = base.slice(base.lastIndexOf("/") + 1);
  return leaf.slice(leaf.lastIndexOf("--") + 2);
}

// The variables of a flow, an action or a test step live in a table named
// var__m_<variable table>_<model sys_id>, which has no table record. Rows keyed by such a name
// (choices) belong to the model's record.
export const VARIABLE_TABLE_PREFIX = "var__m_";
const VARIABLE_TABLE = /^var__m_(?:[a-z0-9_]+_)?([0-9a-f]{32})$/;

export function variableModelOf(tableName: string): string | null {
  return VARIABLE_TABLE.exec(tableName)?.[1] ?? null;
}
