import { nativeRuntimeTrigger } from "./native-runtime-trigger";
import type { BuiltUnit, Fields, UnitRecord } from "./unit";

export interface NativeTriggerContract {
  readonly definitionId: string;
  readonly outputs: readonly Fields[];
  readonly schemas: readonly Fields[];
  readonly actionInputs?: readonly Fields[];
  readonly logicInputs?: readonly Fields[];
}

// SLA Task publication projects the native trigger's output contract onto the flow. These
// fields affect execution; timestamps, labels and other generated dictionary defaults do not.
export const TRIGGER_OUTPUT_FIELDS = [
  "element",
  "active",
  "array",
  "attributes",
  "internal_type",
  "reference",
  "mandatory",
  "max_length",
  "default_value",
  "calculation",
  "reference_qual",
  "reference_qual_condition",
] as const;

function attribute(value: string | undefined, key: string): string {
  return (
    value
      ?.split(",")
      .find((part) => part.startsWith(`${key}=`))
      ?.slice(key.length + 1) ?? ""
  );
}

function expected(row: UnitRecord, fields: Fields): UnitRecord {
  return {
    ...row,
    action: "INSERT_OR_UPDATE",
    fields: { sys_id: row.sysId, ...fields },
    referenceNames: {},
  };
}

function inputs(
  built: BuiltUnit,
  actual: BuiltUnit,
  contract: NativeTriggerContract,
): UnitRecord[] | null {
  if (contract.outputs.length === 0) return null;
  const rows: UnitRecord[] = [];
  for (const output of contract.outputs) {
    if (
      output["model"] !== contract.definitionId ||
      TRIGGER_OUTPUT_FIELDS.some((field) => output[field] === undefined)
    )
      return null;
    const candidates = actual.children.filter(
      (row) =>
        row.table === "sys_hub_flow_input" &&
        row.sysId !== "" &&
        row.fields["model"] === built.head.sysId &&
        row.fields["element"] === output["element"],
    );
    const row = candidates[0];
    if (
      candidates.length !== 1 ||
      row === undefined ||
      built.children.some((wanted) => wanted.sysId === row.sysId)
    )
      return null;
    rows.push(
      expected(row, {
        ...Object.fromEntries(TRIGGER_OUTPUT_FIELDS.map((field) => [field, output[field] ?? ""])),
        model: built.head.sysId,
      }),
    );
  }
  return rows;
}

function schemaContent(schema: Fields, name: string): string | null {
  const original = schema["name"];
  if (!original || !/^FD[a-f0-9]{32}$/.test(original) || !/^FD[a-f0-9]{32}$/.test(name))
    return null;
  try {
    return JSON.stringify(
      JSON.parse((schema["serialized_content"] ?? "").replaceAll(original, name)),
    );
  } catch {
    return null;
  }
}

function schemas(actual: BuiltUnit, contract: NativeTriggerContract): UnitRecord[] | null {
  const owners = new Set([
    actual.head.sysId,
    ...actual.children
      .filter(
        (row) =>
          row.table === "sys_hub_flow_snapshot" && row.fields["parent_flow"] === actual.head.sysId,
      )
      .map((row) => row.sysId),
  ]);
  const names = new Map<string, Fields>();
  for (const output of contract.outputs) {
    const original = attribute(output["attributes"], "co_type_name");
    if (!original) continue;
    const native = contract.schemas.filter(
      (schema) => schema["name"] === original && schema["namespace"] === "FlowDesigner",
    );
    const schema = native[0];
    if (native.length !== 1 || schema === undefined) return null;
    for (const input of actual.children.filter(
      (row) =>
        row.table === "sys_hub_flow_input" &&
        owners.has(row.fields["model"] ?? "") &&
        row.fields["element"] === output["element"],
    )) {
      const name = attribute(input.fields["attributes"], "co_type_name");
      if (name) names.set(name, schema);
    }
  }
  return schemaRows(actual, names);
}

function schemaRows(actual: BuiltUnit, names: ReadonlyMap<string, Fields>): UnitRecord[] | null {
  const rows: UnitRecord[] = [];
  for (const [name, native] of names) {
    const candidates = actual.children.filter(
      (row) => row.table === "sys_complex_object" && row.fields["name"] === name,
    );
    const row = candidates[0];
    const content = schemaContent(native, name);
    if (candidates.length !== 1 || row === undefined || content === null) return null;
    rows.push(
      expected(row, {
        name,
        namespace: "FlowDesigner",
        type: native["type"] ?? "",
        scope_name: native["scope_name"] ?? "",
        serialized_content: content,
      }),
    );
  }
  return rows;
}

function documentationRows(
  built: BuiltUnit,
  actual: BuiltUnit,
  contract: NativeTriggerContract,
): UnitRecord[] {
  return actual.children
    .filter(
      (held) =>
        held.table === "sys_documentation" &&
        held.sysId !== "" &&
        held.fields["name"] === `var__m_sys_hub_flow_input_${built.head.sysId}` &&
        contract.outputs.some((output) => output["element"] === held.fields["element"]),
    )
    .map((held) =>
      expected(held, {
        name: `var__m_sys_hub_flow_input_${built.head.sysId}`,
        element: held.fields["element"] ?? "",
      }),
    );
}

// Enrich only the expected graph, from independently read native metadata. No captured
// execution values become expectations. Unsupported trigger shapes still fail closed.
export function withNativeTriggerInputs(
  built: BuiltUnit,
  actual: BuiltUnit,
  contracts: readonly NativeTriggerContract[],
): BuiltUnit | null {
  if (built.head.table !== "sys_hub_flow") return built;
  const triggers = built.children.filter(
    (row) =>
      row.table === "sys_hub_trigger_instance_v2" &&
      row.sysId !== "" &&
      ["sla_task", "service_catalog"].includes(row.fields["trigger_type"] ?? ""),
  );
  if (triggers.length === 0) return built;
  const trigger = triggers[0];
  if (triggers.length !== 1 || trigger === undefined) return null;
  const matching = contracts.filter(
    (contract) => contract.definitionId === trigger.fields["trigger_definition"],
  );
  const contract = matching[0];
  if (matching.length !== 1 || contract === undefined) return null;
  const row = nativeRuntimeTrigger(actual, trigger);
  const projected =
    trigger.fields["trigger_type"] === "service_catalog"
      ? {
          ...contract,
          outputs: contract.outputs.filter(
            (output) => !output["attributes"]?.split(",").includes("test_input_hidden=true"),
          ),
        }
      : contract;
  const generatedInputs = inputs(built, actual, projected);
  const generatedSchemas = schemas(actual, projected);
  if (row === null || generatedInputs === null || generatedSchemas === null) return null;
  const documentation = documentationRows(built, actual, projected);
  return {
    ...built,
    children: [...built.children, row, ...generatedInputs, ...generatedSchemas, ...documentation],
  };
}
