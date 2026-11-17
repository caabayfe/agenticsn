import type { Row } from "@snagentic/core";

// Native child-table columns used by draft tests. In particular, action active and trigger
// category are SDK XML defaults, and these metadata children have no domain column.
const COLUMNS: Readonly<Record<string, readonly string[]>> = {
  sys_hub_trigger_instance_v2: ["flow", "trigger_type", "trigger_definition", "trigger_inputs"],
  sys_hub_action_instance_v2: ["flow", "action_type", "action_type_parent", "values"],
  sys_hub_sub_flow_instance_v2: ["flow", "subflow", "values"],
  sys_hub_flow_logic_instance_v2: ["flow", "logic_definition", "values"],
  sys_hub_flow_stage: ["flow", "name", "order"],
  sys_hub_flow_input: ["model", "name", "element", "active"],
  sys_hub_flow_output: ["model", "name", "element", "active"],
  sys_hub_flow_variable: ["model", "name", "element", "active"],
  sys_hub_alias_mapping: ["source_id", "target_id"],
  sys_documentation: ["name", "element", "label"],
};

export function draftSchemas(tables: Record<string, Row[]>): void {
  const definitions = tables["sys_db_object"] ?? [];
  const dictionary = tables["sys_dictionary"] ?? [];
  let sequence = 5000;
  for (const [name, columns] of Object.entries(COLUMNS)) {
    definitions.push({
      sys_id: (++sequence).toString(16).padStart(32, "0"),
      name,
      super_class: "",
    });
    for (const element of ["sys_id", "sys_scope", "sys_mod_count", "sys_updated_on", ...columns]) {
      dictionary.push({
        sys_id: (++sequence).toString(16).padStart(32, "0"),
        name,
        element,
        internal_type: "string",
        reference: "",
        unique: "false",
      });
    }
  }
  tables["sys_db_object"] = definitions;
  tables["sys_dictionary"] = dictionary;
}
