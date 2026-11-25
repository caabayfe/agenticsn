import { normalizeScalarInput } from "./compiled-scalar-defaults";
import { emptyParameterMetadata, PARAMETER_DESCRIPTOR_KEYS } from "./compiled-variable-defaults";
import { durationCaptionAgrees } from "./duration-caption";
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
    type === "glide_duration" &&
    typeof value === "string" &&
    held["value"] === value &&
    typeof held["displayValue"] === "string" &&
    durationCaptionAgrees(value, held["displayValue"])
  )
    return { ...held, displayValue: value };
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

// The SDK knows no input types of an action or subflow it holds only the ID of, and builds each
// as a string. The native definition already proved the captured type; a type is not authored.
function nativeType(wanted: Record<string, unknown>, held: Record<string, unknown>) {
  const authored = wanted["parameter"];
  const parameter = held["parameter"];
  if (!object(authored) || !object(parameter)) return held;
  if (Object.keys(authored).length !== 1 || authored["type"] !== "string") return held;
  return { ...held, parameter: { ...parameter, type: "string" } };
}

// Brazil writes no caption for an empty optional input that has a default.
function emptyCaption(wanted: Record<string, unknown>, held: Record<string, unknown>) {
  const blank = (value: unknown) => value === undefined || value === "";
  if (wanted["displayValue"] !== "" || !blank(wanted["value"]) || !blank(held["value"]))
    return held;
  return Object.hasOwn(held, "displayValue") ? held : { ...held, displayValue: "" };
}

// A choice with a default carries that default's caption, a reference its search field.
const CAPTION_KEYS = new Set(["defaultDisplayValue", "fSearchField"]);

// An input the build gives no description of: publication copies the native definition in.
// Only description keys may be there, so it can carry no value or script, and it has to be
// that definition. A list of records has no label to compare; its other metadata is empty.
function nativeDescription(parameter: unknown, definition: Fields): boolean {
  if (!object(parameter)) return false;
  if (parameter["maxsize"] !== Number(definition["max_length"])) return false;
  if (definition["internal_type"] === "records")
    return (
      Object.keys(parameter).every((key) => PARAMETER_DESCRIPTOR_KEYS.has(key)) &&
      emptyParameterMetadata(parameter) &&
      attributesAgree(parameter["attributes"], definition["attributes"])
    );
  const known = (key: string) =>
    PARAMETER_DESCRIPTOR_KEYS.has(key) ||
    (CAPTION_KEYS.has(key) && typeof parameter[key] === "string");
  return (
    Object.keys(parameter).every(known) &&
    parameter["label"] === definition["label"] &&
    parameter["hint"] === definition["hint"] &&
    parameter["order"] === Number(definition["order"])
  );
}

// Native input identity/type/default is independent evidence. Only implicit SDK captions,
// recorded scalar encodings and the description publication adds normalize; explicit
// captions and execution values stay exact.
export function normalizeContractInput(
  wanted: unknown,
  held: unknown,
  definitions: readonly Fields[],
): unknown {
  const definition = definitionOf(wanted, held, definitions);
  if (!definition || !object(wanted) || !object(held)) return held;
  const captioned = caption(wanted, held, definition["internal_type"] ?? "");
  const actual = emptyCaption(wanted, nativeType(wanted, captioned));
  if (wanted["parameter"] === undefined && nativeDescription(held["parameter"], definition))
    return Object.fromEntries(Object.entries(actual).filter(([key]) => key !== "parameter"));
  return normalizeScalarInput(wanted, actual);
}
