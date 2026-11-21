import { redactSecrets } from "../../kernel/redact";
import type { Row } from "../../kernel/row";
import { Catalog } from "../../metadata/domain/catalog";
import { isNameValueTable } from "../../metadata/domain/credential-values";
import { SECRET_TYPES } from "../../metadata/domain/field-rules";
import { DEFAULT_REDACTION, fieldsToRedact } from "../../metadata/domain/redaction";
import { scanSecrets } from "../../metadata/domain/secret-scan";
import { MaskedFieldError } from "./errors";
import type { LiveField, LiveSchema } from "./query-policy";

const SECRET_NAME =
  /(?:passw(?:or)?d|secret|credential|token|api_?key|private_?key|authorization|cookie)/i;

function boundedText(raw: string, remaining: number) {
  const text = scanSecrets(redactSecrets(raw)).text;
  const limit =
    JSON.stringify(text).length > remaining ? Math.max(0, Math.floor(remaining / 6) - 20) : 8000;
  const value = text.slice(0, Math.min(8000, limit));
  return {
    text: value.length < text.length ? `${value}[truncated]` : value,
    truncated: value.length < text.length,
  };
}

function sensitiveLiveField(name: string, field: LiveField): boolean {
  return (
    SECRET_NAME.test(name) ||
    (name.includes(".") && field.name === "value") ||
    SECRET_TYPES.has(field.type) ||
    /encrypt|password|credential/i.test(field.type)
  );
}

// The fields the redaction policy hides for one record of the table. Matching ignores case.
function hiddenFields(schema: LiveSchema, row: Row): ReadonlySet<string> {
  const catalog = new Catalog({
    parents: Object.fromEntries(
      schema.ancestors.map((name, i) => [name, schema.ancestors[i + 1] ?? null]),
    ),
    scopes: {},
    typedFields: {
      [schema.table]: Object.fromEntries(schema.fields.map((field) => [field.name, field.type])),
    },
  });
  const hidden = new Set(fieldsToRedact(catalog, schema.table, row, DEFAULT_REDACTION));
  if (isNameValueTable(catalog, schema.table) && row["name"] === undefined) hidden.add("value");
  return hidden;
}

// Whether output masks the field for at least some records. Asked of a record with no values,
// so a field the policy masks only for certain records counts as masked.
export function maskedLiveField(schema: LiveSchema, name: string, field: LiveField): boolean {
  return sensitiveLiveField(name, field) || hiddenFields(schema, {}).has(name.toLowerCase());
}

// A masked field must not decide which records, order or groups come back.
export function assertNoMaskedField(
  schema: LiveSchema,
  names: readonly string[],
  resolved: ReadonlyMap<string, LiveField>,
): void {
  for (const name of names) {
    const field = resolved.get(name);
    if (field === undefined || maskedLiveField(schema, name, field))
      throw new MaskedFieldError(name);
  }
}

export function redactLiveRow(
  row: Row,
  schema: LiveSchema,
  requested: readonly string[],
  resolved: ReadonlyMap<string, LiveField>,
) {
  const hidden = hiddenFields(schema, row);
  let truncated = false;
  const fields: Record<string, string> = {};
  let remaining = 90000;
  for (const name of requested) {
    const field = resolved.get(name);
    if (field === undefined) continue;
    const raw = row[name];
    if (raw === undefined) continue;
    if (hidden.has(name.toLowerCase()) || sensitiveLiveField(name, field))
      fields[name] = "[redacted]";
    else {
      const value = boundedText(raw, remaining);
      truncated ||= value.truncated;
      fields[name] = value.text;
      remaining -= JSON.stringify(fields[name]).length + name.length + 6;
    }
  }
  return { fields, truncated };
}
