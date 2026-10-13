// Tables whose rows belong to a record and are kept in its file
// <record>.children.<table>.yaml rather than as records of their own (ADR-0017).
export interface ChildTable {
  readonly table: string;
  // References the owning record, or a row of `parentTable`.
  readonly parentField: string;
  // Set when the parent is another child table, listed earlier.
  readonly parentTable?: string;
  // The parent field may name a row of any earlier child table, not only a record
  // (sys_variable_value.document_key usually names a flow step or action instance).
  readonly ownedThroughChildRows?: true;
  // The parent field holds a table's name, not a sys_id: the rows belong to that table's
  // sys_db_object record (choices, ADR-0025).
  readonly ownedByTableName?: true;
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
  { table: "sys_choice", parentField: "name", ownedByTableName: true },
  { table: "wf_workflow_version", parentField: "workflow" },
  { table: "wf_stage", parentField: "workflow_version", parentTable: "wf_workflow_version" },
  { table: "wf_activity", parentField: "workflow_version", parentTable: "wf_workflow_version" },
  { table: "wf_condition", parentField: "activity", parentTable: "wf_activity" },
  { table: "wf_transition", parentField: "from", parentTable: "wf_activity" },
  { table: "sys_variable_value", parentField: "document_key", ownedThroughChildRows: true },
];

// Child rows an agent may edit and push, one row at a time (ADR-0025). Flow and workflow rows
// stay read-only: the platform compiles those records.
export const EDITABLE_CHILD_TABLES: ReadonlySet<string> = new Set([
  "sys_choice",
  "sys_ui_element",
  "sys_ui_list_element",
  "sys_ui_form_section",
  "sys_ui_related_list_entry",
]);
