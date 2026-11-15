import type { NativeTriggerContract } from "./native-trigger-capture";
import type { BuiltUnit, Fields, UnitRecord } from "./unit";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function equal(left: unknown, right: unknown): boolean {
  if (Array.isArray(left))
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value: unknown, index: number) => equal(value, right[index]))
    );
  if (!object(left)) return left === right;
  return (
    object(right) &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(
      ([key, value]) => Object.hasOwn(right, key) && equal(value, right[key]),
    )
  );
}

function parsed(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const held: unknown = JSON.parse(value);
    return object(held) ? held : null;
  } catch {
    return null;
  }
}

function fieldTypes(schema: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const fields = schema[`FlowDesigner:${name}`];
  return object(fields)
    ? Object.fromEntries(Object.entries(fields).filter(([key]) => !key.includes(".$")))
    : null;
}

function emptyScript(value: unknown): boolean {
  return value === undefined || (object(value) && Object.keys(value).length === 0);
}

function descriptor(value: unknown, types: Record<string, unknown>): boolean {
  if (!object(value) || typeof value["name"] !== "string" || !Object.hasOwn(types, value["name"]))
    return false;
  return (
    value["type"] === String(types[value["name"]]).toLowerCase() &&
    value["scriptActive"] === false &&
    value["value"] === "" &&
    value["displayValue"] === "" &&
    emptyScript(value["script"]) &&
    Array.isArray(value["children"]) &&
    value["children"].length === 0
  );
}

function children(value: unknown, types: Record<string, unknown>, wrapped: boolean): boolean {
  if (!Array.isArray(value) || value.length !== Object.keys(types).length) return false;
  const names = new Set<string>();
  return value.every((item: unknown) => {
    if (!object(item) || typeof item["name"] !== "string" || names.has(item["name"])) return false;
    names.add(item["name"]);
    if (!wrapped) return descriptor(item, types);
    return (
      Object.keys(item).every((key) => ["name", "parameter", "scriptActive"].includes(key)) &&
      item["scriptActive"] === false &&
      object(item["parameter"]) &&
      item["parameter"]["name"] === item["name"] &&
      descriptor(item["parameter"], types)
    );
  });
}

function neutralObject(value: unknown, types: Record<string, unknown>): boolean {
  return (
    object(value) &&
    Object.keys(value).length === Object.keys(types).length &&
    Object.keys(types).every((key) => {
      const field = value[key];
      if (!object(field) || Object.keys(field).length !== 1 || !object(field["$cv"])) return false;
      return equal(field["$cv"], { $c: "java.lang.String", $v: "" });
    })
  );
}

function nativeSchema(
  entry: Record<string, unknown>,
  contracts: readonly NativeTriggerContract[],
): Fields | null {
  if (!object(entry["parameter"]) || !object(entry["parameter"]["attributes"])) return null;
  const name = entry["parameter"]["attributes"]["co_type_name"];
  const schemas = contracts.flatMap((contract) =>
    contract.schemas.filter((schema) => schema["name"] === name),
  );
  return schemas.length === 1 ? (schemas[0] ?? null) : null;
}

function neutralParameter(value: unknown): boolean {
  return (
    object(value) &&
    value["scriptActive"] !== true &&
    emptyScript(value["script"]) &&
    (value["value"] === undefined || value["value"] === "") &&
    (value["displayValue"] === undefined || value["displayValue"] === "")
  );
}

function neutral(
  entry: Record<string, unknown>,
  wanted: Record<string, unknown>,
  schema: Fields,
): boolean {
  const before = parsed(wanted["value"]);
  const after = parsed(entry["value"]);
  const native = parsed(schema["serialized_content"]);
  if (!before || !after || !native || !schema["name"] || !object(before["complexObjectSchema"]))
    return false;
  const types = fieldTypes(native, schema["name"]);
  const authoredTypes = fieldTypes(before["complexObjectSchema"], schema["name"]);
  if (!types || !authoredTypes || !equal(types, authoredTypes)) return false;
  if (
    !object(before["complexObject"]) ||
    Object.keys(before["complexObject"]).length !== 0 ||
    wanted["displayValue"] !== wanted["value"]
  )
    return false;
  return (
    before["version"] === "1.0" &&
    before["serializationFormat"] === "JSON" &&
    after["version"] === "1.0" &&
    after["serializationFormat"] === "JSON" &&
    Object.keys(after).every((key) =>
      ["version", "serializationFormat", "complexObject", "complexObjectSchema"].includes(key),
    ) &&
    equal(after["complexObjectSchema"], native) &&
    neutralObject(after["complexObject"], types) &&
    entry["displayValue"] === entry["value"] &&
    children(entry["children"], types, true) &&
    object(entry["parameter"]) &&
    neutralParameter(entry["parameter"]) &&
    entry["parameter"]["type"] === "object" &&
    children(entry["parameter"]["children"], types, false)
  );
}

function normalizedEntry(
  wanted: unknown,
  held: unknown,
  contracts: readonly NativeTriggerContract[],
): unknown {
  if (
    !object(wanted) ||
    !object(held) ||
    wanted["name"] !== "sla_flow_inputs" ||
    held["name"] !== wanted["name"] ||
    wanted["scriptActive"] !== false ||
    held["scriptActive"] !== false ||
    !Object.keys(held).every((key) =>
      ["name", "value", "displayValue", "children", "parameter", "scriptActive"].includes(key),
    )
  )
    return held;
  const schema = nativeSchema(wanted, contracts);
  if (
    schema === null ||
    !neutral(held, wanted, schema) ||
    !object(wanted["parameter"]) ||
    !object(wanted["parameter"]["attributes"]) ||
    !object(held["parameter"]) ||
    !object(held["parameter"]["attributes"])
  )
    return held;
  const attributes = wanted["parameter"]["attributes"];
  const heldAttributes = held["parameter"]["attributes"];
  if (
    !Object.entries(attributes).every(
      ([key, value]) => key === "uiUniqueId" || heldAttributes[key] === value,
    )
  )
    return held;
  return wanted;
}

function normalizedRow(
  wanted: UnitRecord,
  held: UnitRecord,
  contracts: readonly NativeTriggerContract[],
): UnitRecord {
  try {
    const before: unknown = JSON.parse(wanted.fields["values"] ?? "");
    const after: unknown = JSON.parse(held.fields["values"] ?? "");
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length)
      return held;
    return {
      ...held,
      fields: {
        ...held.fields,
        values: JSON.stringify(
          after.map((entry: unknown, index: number) =>
            normalizedEntry(before[index], entry, contracts),
          ),
        ),
      },
    };
  } catch {
    return held;
  }
}

// Only the SDK's empty SLA complex default is reversible here. Actual values/scripts,
// field membership/types, schemas and other action inputs remain independently checked.
export function normalizeEmptySlaInputs(
  built: BuiltUnit,
  actual: BuiltUnit,
  contracts: readonly NativeTriggerContract[],
): BuiltUnit {
  if (contracts.length === 0) return actual;
  return {
    ...actual,
    children: actual.children.map((row) => {
      const wanted = built.children.find(
        (candidate) =>
          candidate.table === "sys_hub_action_instance_v2" &&
          candidate.table === row.table &&
          candidate.sysId === row.sysId &&
          candidate.sysId !== "",
      );
      return wanted === undefined ? row : normalizedRow(wanted, row, contracts);
    }),
  };
}
