import { Option } from "commander";
import { z } from "zod";

function kebabCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

interface Unwrapped {
  readonly field: z.core.$ZodType;
  readonly defaultValue: unknown;
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
function optionFor(key: string, original: z.core.$ZodType): Option {
  const flag = kebabCase(key);
  const description = z.globalRegistry.get(original)?.description ?? "";
  const { field, defaultValue } = unwrap(original);
  if (field instanceof z.ZodBoolean) {
    return defaultValue === true
      ? new Option(`--no-${flag}`, description)
      : new Option(`--${flag}`, description);
  }
  if (field instanceof z.ZodString) {
    return new Option(`--${flag} <value>`, description);
  }
  if (field instanceof z.ZodNumber) {
    return new Option(`--${flag} <number>`, description).argParser(Number);
  }
  if (field instanceof z.ZodArray && field.element instanceof z.ZodString) {
    return new Option(`--${flag} <values...>`, description);
  }
  if (field instanceof z.ZodEnum) {
    return new Option(`--${flag} <value>`, description).choices(field.options.map(String));
  }
  throw new Error(`input field "${key}" has a type the CLI cannot map: ${field._zod.def.type}`);
}

export function optionsFor(schema: z.ZodObject, positional: readonly string[] = []): Option[] {
  return Object.entries(schema.shape)
    .filter(([key]) => !positional.includes(key))
    .map(([key, field]) => optionFor(key, field));
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
