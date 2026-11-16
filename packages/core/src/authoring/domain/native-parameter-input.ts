import { normalizeScalarInput } from "./compiled-scalar-defaults";
import { emptyParameterMetadata, PARAMETER_DESCRIPTOR_KEYS } from "./compiled-variable-defaults";
import type { Fields } from "./unit";

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function attributesAgree(value: unknown, expected: string | undefined): boolean {
  if (!object(value) || expected === undefined) return false;
  const parts = expected.split(",").filter(Boolean);
  if (parts.some((part) => part.indexOf("=") < 1)) return false;
  const entries = parts.map((part) => {
    const separator = part.indexOf("=");
    return [part.slice(0, separator), part.slice(separator + 1)] as const;
  });
  return (
    new Set(entries.map(([key]) => key)).size === entries.length &&
    Object.keys(value).length === entries.length &&
    entries.every(([key, expectedValue]) => value[key] === expectedValue)
  );
}

function definitionOf(wanted: unknown, held: unknown, definitions: readonly Fields[]) {
  if (!object(wanted) || !object(held) || !object(held["parameter"])) return undefined;
  const parameter = held["parameter"];
  const matching = definitions.filter(
    (row) =>
      row["element"] === wanted["name"] &&
      row["element"] === held["name"] &&
      row["sys_id"] === parameter["id"] &&
      row["internal_type"] === parameter["type"] &&
      row["default_value"] === parameter["defaultValue"] &&
      (row["mandatory"] === "true") === parameter["mandatory"],
  );
  return matching.length === 1 ? matching[0] : undefined;
}

function caption(wanted: Record<string, unknown>, held: Record<string, unknown>, type: string) {
  if (wanted["displayValue"] !== wanted["value"]) return held;
  const value = wanted["value"];
  if (
    type === "boolean" &&
    typeof value === "boolean" &&
    held["value"] === (value ? "1" : "0") &&
    held["displayValue"] === String(value)
  )
    return { ...held, value, displayValue: value };
  if (
    type === "integer" &&
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    held["value"] === String(value) &&
    held["displayValue"] === String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  )
    return { ...held, displayValue: value };
  const parameter = held["parameter"];
  if (
    type !== "choice" ||
    held["value"] !== value ||
    !object(parameter) ||
    !Array.isArray(parameter["choices"])
  )
    return held;
  const choices = parameter["choices"].filter(
    (entry: unknown) => object(entry) && entry["value"] === value,
  );
  return choices.length === 1 && object(choices[0]) && choices[0]["label"] === held["displayValue"]
    ? { ...held, displayValue: value }
    : held;
}

// Native input identity/type/default is independent evidence. Only implicit SDK captions
// and recorded scalar encodings normalize; explicit captions and execution values stay exact.
export function normalizeContractInput(
  wanted: unknown,
  held: unknown,
  definitions: readonly Fields[],
): unknown {
  const definition = definitionOf(wanted, held, definitions);
  if (!definition || !object(wanted) || !object(held)) return held;
  const actual = caption(wanted, held, definition["internal_type"] ?? "");
  if (
    wanted["parameter"] === undefined &&
    definition["internal_type"] === "records" &&
    object(held["parameter"]) &&
    emptyParameterMetadata(held["parameter"]) &&
    held["parameter"]["maxsize"] === Number(definition["max_length"]) &&
    attributesAgree(held["parameter"]["attributes"], definition["attributes"]) &&
    Object.keys(held["parameter"]).every((key) => PARAMETER_DESCRIPTOR_KEYS.has(key)) &&
    held["parameter"]["scriptActive"] !== true &&
    held["parameter"]["script"] === undefined
  )
    return Object.fromEntries(Object.entries(actual).filter(([key]) => key !== "parameter"));
  return normalizeScalarInput(wanted, actual);
}
