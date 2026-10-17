// Narrowing of parsed YAML and JSON, which arrive as unknown.
export type Fields = Readonly<Record<string, unknown>>;

export const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const fieldsOf = (value: unknown): Fields => (isFields(value) ? value : {});

export function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
