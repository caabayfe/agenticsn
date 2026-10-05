import type { Row } from "../../kernel/row";
import type { Catalog } from "../../metadata/domain/catalog";
import { isDeniedClass } from "../../metadata/domain/field-rules";

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
    .filter((table) => !isDeniedClass(table) && !DERIVED_CLASSES.has(table));
}

export interface ChildTable {
  readonly table: string;
  // References the owning record, or a row of `parentTable`.
  readonly parentField: string;
  // Set when the parent is another child table, listed earlier.
  readonly parentTable?: string;
}

const FLOW_CHILDREN = [
  "sys_hub_trigger_instance_v2",
  "sys_hub_action_instance_v2",
  "sys_hub_flow_logic_instance_v2",
  "sys_hub_sub_flow_instance_v2",
  "sys_hub_flow_stage",
  "sys_hub_trigger_instance",
  "sys_hub_action_instance",
  "sys_hub_sub_flow_instance",
];

// Order matters: a child table that others reference comes first.
export const CHILD_TABLES: readonly ChildTable[] = [
  ...FLOW_CHILDREN.map((table) => ({ table, parentField: "flow" })),
  { table: "sys_hub_step_instance", parentField: "action" },
  { table: "sys_ui_element", parentField: "sys_ui_section" },
  { table: "sys_ui_list_element", parentField: "list_id" },
  { table: "sys_ui_related_list_entry", parentField: "list_id" },
  { table: "sys_ui_form_section", parentField: "sys_ui_form" },
  { table: "wf_workflow_version", parentField: "workflow" },
  { table: "wf_stage", parentField: "workflow_version", parentTable: "wf_workflow_version" },
  { table: "wf_activity", parentField: "workflow_version", parentTable: "wf_workflow_version" },
  { table: "wf_condition", parentField: "activity", parentTable: "wf_activity" },
  { table: "wf_transition", parentField: "from", parentTable: "wf_activity" },
  { table: "sys_variable_value", parentField: "document_key" },
];

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

export interface OperationalTable {
  readonly table: string;
  // Identifies a row across instances (v_plugin rows have no stable sys_id).
  readonly key: string;
  readonly fields: readonly string[];
}

export const OPERATIONAL_TABLES: readonly OperationalTable[] = [
  { table: "v_plugin", key: "id", fields: ["id", "name", "active", "version", "parent"] },
  { table: "sys_plugins", key: "source", fields: ["source", "name", "active", "version"] },
  {
    table: "sys_store_app",
    key: "sys_id",
    fields: ["sys_id", "scope", "name", "version", "active", "vendor"],
  },
  { table: "domain", key: "sys_id", fields: ["sys_id", "name", "parent", "active"] },
];

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

// Groups child rows by owning record as they stream in. `owners` maps sys_id -> record base
// and is extended with each attached row, so later child tables resolve through earlier ones.
export function childGrouper(parentField: string, owners: Map<string, string>) {
  const attached = new Map<string, Row[]>();
  let orphans = 0;
  return {
    add(row: Row): void {
      const base = owners.get(row[parentField] ?? "");
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
