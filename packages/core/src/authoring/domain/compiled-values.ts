import { withoutUnassignedFields } from "./compiled-input-defaults";
import { normalizeScalarInput } from "./compiled-scalar-defaults";
import type { Fields, UnitRecord } from "./unit";
import { sameValue } from "./values";

const ATTRIBUTES = new Set(["timeFromCreateToActivate", "element_mapping_provider", "uiType"]);
const JSON_FIELDS = new Set(["values", "trigger_inputs", "subflow_inputs"]);
const DEFAULTS: Readonly<Record<string, unknown>> = {
  fromTemplate: false,
  scriptActive: false,
  fSequence: 0,
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Brazil clears the SDK's duplicated display label for computed record and relative-date inputs.
// The execution value and parameter descriptor still have to match exactly.
function generatedDisplay(wanted: Record<string, unknown>, held: Record<string, unknown>): boolean {
  if (
    typeof wanted["value"] !== "string" ||
    wanted["displayValue"] !== wanted["value"] ||
    held["value"] !== wanted["value"] ||
    held["displayValue"] !== "" ||
    !object(wanted["parameter"])
  )
    return false;
  if (wanted["parameter"]["type"] === "document_id")
    return /^\{\{[^{}]+\}\}$/.test(wanted["value"]);
  if (wanted["parameter"]["type"] !== "schedule_date_time") return false;
  try {
    const date: unknown = JSON.parse(wanted["value"]);
    return object(date) && date["date_type"] === "relative";
  } catch {
    return false;
  }
}

// Publication fills parameter descriptors from the referenced input/output definitions.
// Values, scripts, array membership/order and every authored descriptor still have to agree.
function jsonAgrees(wanted: unknown, held: unknown, parameter = false): boolean {
  if (Array.isArray(wanted))
    return (
      Array.isArray(held) &&
      wanted.length === held.length &&
      wanted.every((value, index) => jsonAgrees(value, held[index], parameter))
    );
  if (!object(wanted)) return wanted === held;
  const actual = normalizeScalarInput(wanted, held, false);
  if (!object(actual)) return false;
  const complete = Object.entries(wanted).every(
    ([key, value]) =>
      (key === "displayValue" && generatedDisplay(wanted, actual)) ||
      (Object.hasOwn(actual, key) &&
        jsonAgrees(value, actual[key], parameter || key === "parameter")),
  );
  return (
    complete &&
    Object.entries(actual).every(
      ([key, value]) =>
        Object.hasOwn(wanted, key) ||
        parameter ||
        (Object.hasOwn(DEFAULTS, key) && DEFAULTS[key] === value),
    )
  );
}

function sameJson(wanted: string, held: string): boolean {
  try {
    const built: unknown = JSON.parse(wanted);
    const captured: unknown = JSON.parse(held);
    return jsonAgrees(built, withoutUnassignedFields(built, captured));
  } catch {
    return false;
  }
}

const attributes = (value: string) => value.split(",").filter(Boolean).sort();
export const orderedAttributes = (value: string): string => attributes(value).join(",");

function heldAttributes(wanted: string, held: string): string {
  const managed = new Set(attributes(wanted).map((entry) => entry.split("=")[0]));
  return attributes(held)
    .filter((entry) => {
      const key = entry.split("=")[0] ?? "";
      return managed.has(key) || !ATTRIBUTES.has(key);
    })
    .join(",");
}

const REFERENCE: Readonly<Record<string, string>> = {
  sys_hub_action_instance_v2: "action_type",
  sys_hub_sub_flow_instance_v2: "subflow",
};

const OMITTED_DEFAULTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  // SDK 4.14 emits this empty default for a column absent from the Brazil catalog dictionary.
  sc_cat_item: { view: "" },
  sys_hub_action_instance_v2: { active: "true" },
  sys_hub_step_instance: { active: "true" },
  sys_hub_trigger_instance_v2: { category: "" },
};

export function exportedDefaultsAgree(wanted: UnitRecord, actual: UnitRecord): boolean {
  return Object.entries(OMITTED_DEFAULTS[wanted.table] ?? {}).every(
    ([field, value]) =>
      wanted.fields[field] !== value ||
      actual.fields[field] === undefined ||
      sameValue(value, actual.fields[field]),
  );
}

// Recorded Brazil exports omit these SDK defaults. A non-default authored value still
// requires evidence; this never turns a missing script, input or disabled step into a match.
export function exportedDefaults(wanted: UnitRecord, actual: UnitRecord): UnitRecord {
  const defaults = OMITTED_DEFAULTS[wanted.table] ?? {};
  const fields = Object.fromEntries(
    Object.entries(wanted.fields).filter(
      ([field, value]) => actual.fields[field] !== undefined || defaults[field] !== value,
    ),
  );
  return { ...wanted, fields };
}

export function compiledFields(
  wanted: UnitRecord,
  actual: UnitRecord,
  references: ReadonlyMap<string, string>,
): Fields {
  if (!wanted.table.startsWith("sys_hub_")) return actual.fields;
  const fields = { ...actual.fields };
  for (const [field, value] of Object.entries(wanted.fields)) {
    const held = fields[field];
    if (held === undefined) continue;
    if (field === "attributes") fields[field] = heldAttributes(value, held);
    if (JSON_FIELDS.has(field) && sameJson(value, held)) fields[field] = value;
    if (REFERENCE[wanted.table] === field && references.get(held) === value) fields[field] = value;
  }
  return fields;
}
