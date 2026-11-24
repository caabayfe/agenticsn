import type { BuiltUnit, Fields, UnitRecord } from "./unit";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const PARAMETER_DESCRIPTOR_KEYS: ReadonlySet<string> = new Set([
  "children",
  "id",
  "label",
  "name",
  "type",
  "typeLabel",
  "order",
  "extended",
  "mandatory",
  "readOnly",
  "hint",
  "help",
  "maxsize",
  "reference",
  "reference_display",
  "fDataStructure",
  "choices",
  "defaultChoices",
  "choiceOption",
  "table",
  "columnName",
  "defaultValue",
  "use_dependent",
  "fShowReferenceFinder",
  "local",
  "attributes",
  "sysClassName",
  "ref_qual",
  "dependent_on",
]);

export function emptyParameterMetadata(value: Record<string, unknown>): boolean {
  if (
    ["extended", "readOnly", "use_dependent", "fShowReferenceFinder", "local"].some(
      (key) => value[key] !== false,
    )
  )
    return false;
  if (
    ["children", "choices", "defaultChoices"].some(
      (key) => !Array.isArray(value[key]) || value[key].length !== 0,
    )
  )
    return false;
  if (
    [
      "help",
      "reference",
      "reference_display",
      "fDataStructure",
      "choiceOption",
      "table",
      "columnName",
      "sysClassName",
      "ref_qual",
      "dependent_on",
    ].some((key) => value[key] !== "")
  )
    return false;
  return true;
}

function descriptor(value: unknown, definition: Fields): boolean {
  if (!object(value) || Object.keys(value).some((key) => !PARAMETER_DESCRIPTOR_KEYS.has(key)))
    return false;
  if (definition["internal_type"] !== "string" || definition["active"] !== "true") return false;
  const fields = {
    id: "sys_id",
    name: "element",
    type: "internal_type",
    label: "label",
    defaultValue: "default_value",
    hint: "hint",
  };
  if (Object.entries(fields).some(([key, field]) => value[key] !== definition[field])) return false;
  if (
    value["maxsize"] !== Number(definition["max_length"]) ||
    value["order"] !== Number(definition["order"])
  )
    return false;
  if (value["mandatory"] !== (definition["mandatory"] === "true")) return false;
  if (!emptyParameterMetadata(value)) return false;
  const attributes = value["attributes"];
  return (
    definition["attributes"] === "" &&
    object(attributes) &&
    Object.entries(attributes).every(
      ([key, held]) =>
        key === "timeFromCreateToActivate" && typeof held === "string" && /^\d+$/.test(held),
    )
  );
}

// Brazil repeats the pill assigned to a declared variable as the assignment's caption, which
// the SDK builds empty. The assignment itself still has to be that pill.
function assignedCaption(wanted: Record<string, unknown>, held: Record<string, unknown>) {
  const value = wanted["value"];
  if (
    wanted["displayValue"] !== "" ||
    typeof value !== "string" ||
    !/^\{\{[^{}]+\}\}$/.test(value) ||
    held["value"] !== value ||
    held["displayValue"] !== value
  )
    return held;
  return { ...held, displayValue: "" };
}

function entries(wanted: unknown, held: unknown, definitions: readonly Fields[]): unknown {
  if (!Array.isArray(wanted) || !Array.isArray(held) || wanted.length !== held.length) return held;
  return held.map((entry, index) => {
    const before: unknown = wanted[index];
    if (!object(before) || !object(entry)) return entry;
    if (before["id"] !== entry["id"] || before["name"] !== entry["name"]) return entry;
    const matching = definitions.filter(
      (row) => row["sys_id"] === before["id"] && row["element"] === before["name"],
    );
    const definition = matching[0];
    if (matching.length !== 1 || definition === undefined) return entry;
    if (Object.hasOwn(before, "parameter")) return assignedCaption(before, entry);
    if (!descriptor(entry["parameter"], definition)) return entry;
    return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "parameter"));
  });
}

// Publication copies the authored string-variable declaration into assignment UI descriptors.
// Strip only that proven projection; assignments, scripts, membership and ordering remain exact.
export function normalizeVariableDescriptors(
  built: BuiltUnit,
  wanted: UnitRecord,
  actual: UnitRecord,
): UnitRecord {
  if (wanted.table !== "sys_hub_flow_logic_instance_v2") return actual;
  const definitions = built.children
    .filter(
      (row) =>
        row.table === "sys_hub_flow_variable" &&
        row.sysId !== "" &&
        row.fields["model"] === built.head.sysId,
    )
    .map((row) => row.fields);
  if (definitions.length === 0) return actual;
  try {
    const before: unknown = JSON.parse(wanted.fields["values"] ?? "");
    const after: unknown = JSON.parse(actual.fields["values"] ?? "");
    if (!object(before) || !object(after)) return actual;
    return {
      ...actual,
      fields: {
        ...actual.fields,
        values: JSON.stringify({
          ...after,
          variables: entries(before["variables"], after["variables"], definitions),
          inputs: entries(before["inputs"], after["inputs"], definitions),
        }),
      },
    };
  } catch {
    return actual;
  }
}
