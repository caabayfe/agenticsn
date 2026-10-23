import type { Row } from "../../kernel/row";
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

export interface AttachedChildren {
  // Record base -> its child rows, sorted by sys_id.
  readonly attached: ReadonlyMap<string, readonly Row[]>;
  readonly orphans: number;
}

// The variables of a flow, an action or a test step live in a table named
// var__m_<variable table>_<model sys_id>, which has no table record. Rows keyed by such a name
// (choices) belong to the model's record.
export const VARIABLE_TABLE_PREFIX = "var__m_";
const VARIABLE_TABLE = /^var__m_(?:[a-z0-9_]+_)?([0-9a-f]{32})$/;

export function variableModelOf(tableName: string): string | null {
  return VARIABLE_TABLE.exec(tableName)?.[1] ?? null;
}

// Groups child rows by owning record as they stream in. `owners` maps sys_id -> record base
// and is extended with each attached row, so later child tables resolve through earlier ones.
// `alias` names a second key to try when the parent field's own value has no owner.
export function childGrouper(
  parentField: string,
  owners: Map<string, string>,
  alias: (key: string) => string | null = () => null,
) {
  const attached = new Map<string, Row[]>();
  let orphans = 0;
  return {
    add(row: Row): void {
      const key = row[parentField] ?? "";
      const base = owners.get(key) ?? owners.get(alias(key) ?? "");
      if (base === undefined) {
        orphans += 1;
        return;
      }
      const list = attached.get(base);
      if (list === undefined) {
        attached.set(base, [row]);
      } else {
        list.push(row);
      }
      owners.set(row["sys_id"] ?? "", base);
    },
    result(): AttachedChildren {
      for (const list of attached.values()) {
        list.sort((a, b) => ((a["sys_id"] ?? "") < (b["sys_id"] ?? "") ? -1 : 1));
      }
      return { attached, orphans };
    },
  };
}

export function attachChildren(
  rows: readonly Row[],
  parentField: string,
  owners: Map<string, string>,
): AttachedChildren {
  const grouper = childGrouper(parentField, owners);
  for (const row of rows) {
    grouper.add(row);
  }
  return grouper.result();
}
