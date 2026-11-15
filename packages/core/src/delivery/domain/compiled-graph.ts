import type { BuiltUnit, UnitRecord } from "../../authoring/domain/unit";

const SNAPSHOTS = new Set(["sys_hub_flow_snapshot", "sys_hub_action_type_snapshot"]);
const OWNER: Readonly<Record<string, string>> = {
  sys_hub_trigger_instance_v2: "flow",
  sys_hub_action_instance_v2: "flow",
  sys_hub_sub_flow_instance_v2: "flow",
  sys_hub_flow_logic_instance_v2: "flow",
  sys_hub_flow_input: "model",
  sys_hub_flow_output: "model",
  sys_hub_flow_variable: "model",
  sys_hub_flow_stage: "flow",
  sys_hub_step_instance: "action",
  sys_hub_step_ext_input: "model",
  sys_hub_step_ext_output: "model",
  sys_hub_action_input: "model",
  sys_hub_action_output: "model",
  sys_hub_alias_mapping: "source_id",
  sys_variable_value: "document_key",
  sys_element_mapping: "id",
  sys_hub_pill_compound: "attached_to",
  sys_hub_action_status_metadata: "action_type_id",
  sys_flow_cat_variable_model: "id",
  sys_flow_cat_variable: "flow_catalog_model",
  sys_flow_trigger_plan: "snapshot",
  sys_flow_subflow_plan: "snapshot",
  sys_hub_action_plan: "snapshot",
};

function owner(record: UnitRecord): string {
  if (record.table === "sys_documentation" || record.table === "sys_choice")
    return /_([a-f0-9]{32})$/.exec(record.fields["name"] ?? "")?.[1] ?? "";
  return record.fields[OWNER[record.table] ?? ""] ?? "";
}

function snapshotRows(unit: BuiltUnit): ReadonlySet<string> {
  const ids = new Set(
    unit.children.filter((row) => SNAPSHOTS.has(row.table)).map((row) => row.sysId),
  );
  for (const field of ["master_snapshot", "latest_snapshot"]) {
    const id = unit.head.fields[field];
    if (id) ids.add(id);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of unit.children) {
      if (row.sysId !== "" && !ids.has(row.sysId) && ids.has(owner(row))) {
        ids.add(row.sysId);
        changed = true;
      }
    }
  }
  return ids;
}

const POINTER_FIELDS = new Set(["sys_id", "latest_snapshot", "compiler_build", "version_record"]);
const TRIGGER_INPUTS = new Set(["current", "table_name"]);

function generated(row: UnitRecord, built: BuiltUnit, actual: BuiltUnit): boolean {
  if (built.children.some((wanted) => wanted.sysId === row.sysId && wanted.table === row.table))
    return false;
  const id = actual.head.sysId;
  if (row.table === actual.head.table && row.sysId === id)
    return Object.keys(row.fields).every((field) => POINTER_FIELDS.has(field));
  if (row.table === "sys_flow_record_trigger")
    return row.sysId === actual.head.fields["remote_trigger_id"];
  if (row.table === "sys_trigger_runner_mapping")
    return (
      row.fields["identifier"] === id &&
      row.fields["trigger"] === actual.head.fields["remote_trigger_id"]
    );
  if (row.table === "sys_hub_action_plan") return row.fields["action_id"] === id;
  if (actual.head.fields["type"] !== "flow" || !TRIGGER_INPUTS.has(row.fields["element"] ?? ""))
    return false;
  return (
    (row.table === "sys_hub_flow_input" && row.fields["model"] === id) ||
    (row.table === "sys_documentation" && row.fields["name"] === `var__m_sys_hub_flow_input_${id}`)
  );
}

// Snapshot copies have new physical IDs and owners. Exclude only proven descendants and
// the recorded generated runtime rows; unknown extra authored rows still fail comparison.
export function authoredCaptureRows(built: BuiltUnit, actual: BuiltUnit): readonly UnitRecord[] {
  const snapshots = snapshotRows(actual);
  return actual.children.filter(
    (row) => row.sysId !== "" && !snapshots.has(row.sysId) && !generated(row, built, actual),
  );
}
