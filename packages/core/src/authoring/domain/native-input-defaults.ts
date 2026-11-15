import type { NativeTriggerContract } from "./native-trigger-capture";
import type { BuiltUnit, Fields, UnitRecord } from "./unit";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const blank = (value: unknown) => value === undefined || value === "";
const empty = (value: unknown) =>
  value === undefined || (object(value) && Object.keys(value).length === 0);

function optional(entry: Record<string, unknown>, definition: Fields, owner: string): boolean {
  const parameter = entry["parameter"];
  return (
    definition["mandatory"] === "false" &&
    definition["default_value"] === "" &&
    object(parameter) &&
    parameter["id"] === definition["sys_id"] &&
    parameter["name"] === definition["element"] &&
    parameter["type"] === definition["internal_type"] &&
    parameter["defaultValue"] === "" &&
    entry["scriptActive"] === false &&
    blank(entry["value"]) &&
    entry["displayValue"] === "" &&
    blank(parameter["value"]) &&
    blank(parameter["displayValue"]) &&
    parameter["scriptActive"] !== true &&
    empty(parameter["script"]) &&
    (entry["children"] === undefined ||
      (Array.isArray(entry["children"]) && entry["children"].length === 0)) &&
    (parameter["children"] === undefined ||
      (Array.isArray(parameter["children"]) && parameter["children"].length === 0)) &&
    Object.keys(entry).every((key) =>
      [
        "name",
        "value",
        "displayValue",
        "children",
        "parameter",
        "scriptActive",
        "id",
        "flowLogicInstanceSysId",
        "displayField",
      ].includes(key),
    ) &&
    (entry["id"] === undefined || entry["id"] === definition["sys_id"]) &&
    (entry["flowLogicInstanceSysId"] === undefined || entry["flowLogicInstanceSysId"] === owner)
  );
}

function scalars(wanted: unknown, held: unknown): unknown {
  if (
    !object(wanted) ||
    !object(held) ||
    !object(wanted["parameter"]) ||
    !object(held["parameter"]) ||
    wanted["parameter"]["type"] !== held["parameter"]["type"] ||
    wanted["name"] !== held["name"]
  )
    return held;
  const type = wanted["parameter"]["type"];
  const normalized = { ...held };
  if (type === "integer") {
    for (const field of ["value", "displayValue"]) {
      const value = wanted[field];
      if (typeof value === "number" && Number.isSafeInteger(value) && held[field] === String(value))
        normalized[field] = value;
    }
  }
  if (
    ["reference", "document_id"].includes(String(type)) &&
    typeof wanted["value"] === "string" &&
    (/^[a-f0-9]{32}$/.test(wanted["value"]) || /^\{\{[^{}]+\}\}$/.test(wanted["value"])) &&
    wanted["value"] === held["value"] &&
    (wanted["displayValue"] === "" || wanted["displayValue"] === wanted["value"]) &&
    typeof held["displayValue"] === "string"
  )
    normalized["displayValue"] = wanted["displayValue"];
  return normalized;
}

function array(
  wanted: readonly unknown[],
  held: readonly unknown[],
  definitions: readonly Fields[],
  owner: string,
): unknown[] {
  const names = new Set(wanted.filter(object).map((entry) => entry["name"]));
  const kept = held.filter((entry) => {
    if (
      !object(entry) ||
      names.has(entry["name"]) ||
      held.filter((value) => object(value) && value["name"] === entry["name"]).length !== 1
    )
      return true;
    const matching = definitions.filter((definition) => definition["element"] === entry["name"]);
    const definition = matching[0];
    return matching.length !== 1 || definition === undefined || !optional(entry, definition, owner);
  });
  return kept.map((entry, index) => scalars(wanted[index], entry));
}

function row(
  wanted: UnitRecord,
  actual: UnitRecord,
  contracts: readonly NativeTriggerContract[],
): UnitRecord {
  try {
    const before: unknown = JSON.parse(wanted.fields["values"] ?? "");
    const after: unknown = JSON.parse(actual.fields["values"] ?? "");
    const action = wanted.table === "sys_hub_action_instance_v2";
    const model = wanted.fields[action ? "action_type" : "logic_definition"];
    const definitions = contracts
      .flatMap((contract) => (action ? contract.actionInputs : contract.logicInputs) ?? [])
      .filter((input) => input["model"] === model);
    if (Array.isArray(before) && Array.isArray(after))
      return {
        ...actual,
        fields: {
          ...actual.fields,
          values: JSON.stringify(array(before, after, definitions, actual.sysId)),
        },
      };
    if (
      object(before) &&
      object(after) &&
      Array.isArray(before["inputs"]) &&
      Array.isArray(after["inputs"])
    )
      return {
        ...actual,
        fields: {
          ...actual.fields,
          values: JSON.stringify({
            ...after,
            inputs: array(before["inputs"], after["inputs"], definitions, actual.sysId),
          }),
        },
      };
    return actual;
  } catch {
    return actual;
  }
}

// Remove only independently proven native optional empty inputs. Authored membership/order,
// scripts, reference IDs, numeric values and unknown non-empty inputs are still compared.
export function normalizeNativeDefaults(
  built: BuiltUnit,
  actual: BuiltUnit,
  contracts: readonly NativeTriggerContract[],
): BuiltUnit {
  if (contracts.length === 0) return actual;
  return {
    ...actual,
    children: actual.children.map((held) => {
      const wanted = built.children.find(
        (candidate) =>
          ["sys_hub_action_instance_v2", "sys_hub_flow_logic_instance_v2"].includes(
            candidate.table,
          ) &&
          candidate.table === held.table &&
          candidate.sysId === held.sysId &&
          candidate.sysId !== "",
      );
      return wanted === undefined ? held : row(wanted, held, contracts);
    }),
  };
}
