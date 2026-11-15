import { Option } from "commander";
import { z } from "zod";

function kebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

interface Unwrapped {
  readonly field: z.core.$ZodType;
  readonly defaultValue: unknown;
}

function fieldExtras(field: z.core.$ZodType, defaultValue: unknown): string[] {
  const defaults =
    defaultValue === undefined ||
    typeof defaultValue === "boolean" ||
    (Array.isArray(defaultValue) && defaultValue.length === 0)
      ? []
      : [`default: ${JSON.stringify(defaultValue)}`];
  if (!(field instanceof z.ZodNumber)) return defaults;
  const min = field.minValue;
  const max = field.maxValue;
  const finiteMin = min !== null && Number.isFinite(min);
  const finiteMax = max !== null && Number.isFinite(max);
  const range =
    finiteMin && finiteMax
      ? `range: ${min}–${max}`
      : finiteMin
        ? `minimum: ${min}`
        : finiteMax
          ? `maximum: ${max}`
          : "";
  return range === "" ? defaults : [...defaults, range];
}

export function fieldDescription(original: z.core.$ZodType, fallback: string): string {
  const { field, defaultValue } = unwrap(original);
  const extras = fieldExtras(field, defaultValue);
  return `${fallback}${extras.length === 0 ? "" : ` (${extras.join("; ")})`}`;
}

export function inputDescription(key: string, field: z.core.$ZodType): string {
  return (
    z.globalRegistry.get(field)?.description ?? key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)
  );
}

function unwrap(field: z.core.$ZodType): Unwrapped {
  if (field instanceof z.ZodDefault) {
    return { field: field.unwrap(), defaultValue: field.def.defaultValue };
  }
  if (field instanceof z.ZodOptional) {
    return { field: field.unwrap(), defaultValue: undefined };
  }
  return { field, defaultValue: undefined };
}

// Maps one input field to a CLI option. Validation stays with zod; options only collect text.
function typedOption(
  flag: string,
  { field, defaultValue }: Unwrapped,
  description: string,
): Option {
  if (field instanceof z.ZodBoolean) {
    return defaultValue === true
      ? new Option(`--no-${flag}`, description)
      : new Option(`--${flag}`, description);
  }
  if (field instanceof z.ZodString) {
    return new Option(`--${flag} <${flag}>`, description);
  }
  if (field instanceof z.ZodNumber) {
    return new Option(`--${flag} <${flag}>`, description).argParser(Number);
  }
  if (field instanceof z.ZodArray && field.element instanceof z.ZodString) {
    return new Option(`--${flag} <${flag}...>`, description);
  }
  if (field instanceof z.ZodArray && field.element instanceof z.ZodNumber) {
    return new Option(`--${flag} <${flag}...>`, description).argParser(
      (value: string, previous: number[] | undefined) => [...(previous ?? []), Number(value)],
    );
  }
  if (field instanceof z.ZodEnum) {
    return new Option(`--${flag} <${flag}>`, description).choices(field.options.map(String));
  }
  throw new Error(`input field "${flag}" has a type the CLI cannot map: ${field._zod.def.type}`);
}

export function optionsFor(
  schema: z.ZodObject,
  positional: readonly string[] = [],
  descriptions: Readonly<Record<string, string>> = {},
): Option[] {
  return Object.entries(schema.shape)
    .filter(([key]) => !positional.includes(key))
    .map(([key, field]) =>
      typedOption(
        kebabCase(key),
        unwrap(field),
        fieldDescription(field, descriptions[key] ?? inputDescription(key, field)),
      ).helpGroup(field.safeParse(undefined).success ? "Options:" : "Required:"),
    );
}

// `<name>` when the field is required, `[name]` when it may be omitted.
export function argumentSyntax(schema: z.ZodObject, key: string): string {
  const field = schema.shape[key];
  if (field === undefined) {
    throw new Error(`positional argument "${key}" is not an input field`);
  }
  const name = unwrap(field).field instanceof z.ZodArray ? `${kebabCase(key)}...` : kebabCase(key);
  return field.safeParse(undefined).success ? `[${name}]` : `<${name}>`;
}
