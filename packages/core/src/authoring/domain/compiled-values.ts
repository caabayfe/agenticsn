import type { Fields, UnitRecord } from "./unit";

const ATTRIBUTES = new Set(["timeFromCreateToActivate", "element_mapping_provider", "uiType"]);
const JSON_FIELDS = new Set(["values", "trigger_inputs", "subflow_inputs"]);
const DEFAULTS: Readonly<Record<string, unknown>> = {
  fromTemplate: false,
  scriptActive: false,
  fSequence: 0,
};
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  if (!object(held)) return false;
  const complete = Object.entries(wanted).every(
    ([key, value]) =>
      Object.hasOwn(held, key) && jsonAgrees(value, held[key], parameter || key === "parameter"),
  );
  return (
    complete &&
    Object.entries(held).every(
      ([key, value]) =>
        Object.hasOwn(wanted, key) ||
        parameter ||
        (Object.hasOwn(DEFAULTS, key) && DEFAULTS[key] === value),
    )
  );
}

function sameJson(wanted: string, held: string): boolean {
  try {
    return jsonAgrees(JSON.parse(wanted), JSON.parse(held));
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
  sys_hub_action_instance_v2: { active: "true" },
  sys_hub_step_instance: { active: "true" },
  sys_hub_trigger_instance_v2: { category: "" },
};

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
