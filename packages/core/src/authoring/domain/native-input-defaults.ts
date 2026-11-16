import { normalizeScalarInput } from "./compiled-scalar-defaults";
import { normalizeVariableDescriptors } from "./compiled-variable-defaults";
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
  return kept.map((entry, index) =>
    definitions.length > 0 ? normalizeScalarInput(wanted[index], entry) : entry,
  );
}

function row(
  wanted: UnitRecord,
  actual: UnitRecord,
  contracts: readonly Pick<NativeTriggerContract, "actionInputs" | "logicInputs">[],
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
  contracts: readonly Pick<NativeTriggerContract, "actionInputs" | "logicInputs">[],
): BuiltUnit {
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
      return wanted === undefined
        ? held
        : row(wanted, normalizeVariableDescriptors(built, wanted, held), contracts);
    }),
  };
}
