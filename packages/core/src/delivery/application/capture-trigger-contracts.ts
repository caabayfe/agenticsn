import {
  type BuiltUnit,
  type NativeTriggerContract,
  TRIGGER_OUTPUT_FIELDS,
} from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/index";

const ID = /^[a-f0-9]{32}$/;
const PARAMETER_FIELDS = [
  "sys_id",
  "model",
  "element",
  "internal_type",
  "default_value",
  "mandatory",
  "attributes",
];
const attribute = (value: string, key: string) =>
  value
    .split(",")
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(key.length + 1) ?? "";

async function read(
  reader: InstanceReader,
  table: string,
  key: string,
  ids: readonly string[],
  fields: readonly string[],
  signal: AbortSignal,
  extra = "",
) {
  const pager = new KeysetPager(reader);
  const rows: Readonly<Record<string, string>>[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const listing = {
      kind: "snapshot" as const,
      table: TableName.parse(table),
      base: `${key}IN${ids.slice(offset, offset + 100).join(",")}${extra}`,
      fields,
    };
    for await (const row of pager.rows(listing, signal)) rows.push(row);
  }
  return rows;
}

function references(built: BuiltUnit, table: string, field: string): string[] {
  return [
    ...new Set(
      built.children
        .filter((row) => row.table === table && row.sysId !== "")
        .flatMap((row) => {
          const id = row.fields[field];
          return id !== undefined && ID.test(id) ? [id] : [];
        }),
    ),
  ];
}

function triggerDefinitions(built: BuiltUnit): string[] {
  return [
    ...new Set(
      built.children
        .filter(
          (row) =>
            row.table === "sys_hub_trigger_instance_v2" &&
            row.sysId !== "" &&
            row.fields["trigger_type"] === "sla_task",
        )
        .flatMap((row) => {
          const id = row.fields["trigger_definition"];
          return id !== undefined && ID.test(id) ? [id] : [];
        }),
    ),
  ];
}

// Additional indexed reads are confined to SLA Task captures, whose compiler generates
// executable input contracts absent from the SDK build. Missing/unreadable evidence cannot
// certify generated inputs or schemas. All I/O uses the shared reader/pager and scheduler.
export async function captureTriggerContracts(
  reader: InstanceReader,
  built: BuiltUnit,
  signal: AbortSignal,
): Promise<readonly NativeTriggerContract[]> {
  const definitions = triggerDefinitions(built);
  if (built.head.table !== "sys_hub_flow" || definitions.length === 0) return [];
  const outputs = await read(
    reader,
    "sys_hub_trigger_output",
    "model",
    definitions,
    ["sys_id", "model", ...TRIGGER_OUTPUT_FIELDS],
    signal,
  );
  const names = [
    ...new Set(
      outputs
        .map((output) => attribute(output["attributes"] ?? "", "co_type_name"))
        .filter((name) => /^FD[a-f0-9]{32}$/.test(name)),
    ),
  ];
  const schemas = await read(
    reader,
    "sys_complex_object",
    "name",
    names,
    ["sys_id", "name", "namespace", "type", "scope_name", "serialized_content"],
    signal,
    "^namespace=FlowDesigner",
  );
  const actionInputs = await read(
    reader,
    "sys_hub_action_input",
    "model",
    references(built, "sys_hub_action_instance_v2", "action_type"),
    PARAMETER_FIELDS,
    signal,
  );
  const logicInputs = await read(
    reader,
    "sys_hub_flow_logic_input",
    "model",
    references(built, "sys_hub_flow_logic_instance_v2", "logic_definition"),
    PARAMETER_FIELDS,
    signal,
  );
  return definitions.map((definitionId) => ({
    definitionId,
    outputs: outputs.filter((output) => output["model"] === definitionId),
    schemas,
    actionInputs,
    logicInputs,
  }));
}

// Subflow branch labels are optional native inputs. Only changed subflows with logic need
// these indexed reads; ordinary reads and no-change pulls do not acquire extra requests.
export async function captureLogicInputs(
  reader: InstanceReader,
  built: BuiltUnit,
  signal: AbortSignal,
) {
  if (built.head.table !== "sys_hub_flow" || built.head.fields["type"] !== "subflow") return [];
  return read(
    reader,
    "sys_hub_flow_logic_input",
    "model",
    references(built, "sys_hub_flow_logic_instance_v2", "logic_definition"),
    PARAMETER_FIELDS,
    signal,
  );
}
