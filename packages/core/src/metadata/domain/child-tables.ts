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
  // The record classes that own these rows directly: a pull reads the rows of such a record when
  // it is new to the mirror, as rows may be older than their owner.
  readonly ownerClasses?: readonly string[];
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
  ...FLOW_CHILDREN.map((table) => ({ table, parentField: "flow", ownerClasses: ["sys_hub_flow"] })),
  { table: "sys_hub_step_instance", parentField: "action" },
  { table: "sys_ui_element", parentField: "sys_ui_section", ownerClasses: ["sys_ui_section"] },
  { table: "sys_ui_list_element", parentField: "list_id", ownerClasses: ["sys_ui_list"] },
  {
    table: "sys_ui_related_list_entry",
    parentField: "list_id",
    ownerClasses: ["sys_ui_related_list"],
  },
  { table: "sys_ui_form_section", parentField: "sys_ui_form", ownerClasses: ["sys_ui_form"] },
  {
    table: "sys_choice",
    parentField: "name",
    ownedByTableName: true,
    ownerClasses: ["sys_db_object"],
  },
  // Whether a script runs on the latest ECMAScript engine: not a metadata class, keyed by the
  // script's sys_id. The SDK writes it as an update of its own (spec 009 mirror plan M1).
  {
    table: "sys_es_latest_script",
    parentField: "id",
    ownerClasses: ["sys_script_include"],
  },
  { table: "wf_workflow_version", parentField: "workflow", ownerClasses: ["wf_workflow"] },
  { table: "wf_stage", parentField: "workflow_version", parentTable: "wf_workflow_version" },
  { table: "wf_activity", parentField: "workflow_version", parentTable: "wf_workflow_version" },
  { table: "wf_condition", parentField: "activity", parentTable: "wf_activity" },
  { table: "wf_transition", parentField: "from", parentTable: "wf_activity" },
  { table: "sys_variable_value", parentField: "document_key", ownedThroughChildRows: true },
];
