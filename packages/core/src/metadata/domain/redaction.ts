import { redactSecrets } from "../../kernel/redact";
import type { Row } from "../../kernel/row";
import type { Catalog } from "./catalog";
import { secretFields } from "./field-rules";

export interface RedactionPolicy {
  // Raised whenever what is redacted changes: a pull then re-reads what the change affects.
  readonly version: number;
  // Table -> fields whose values are never written (applies to subclasses too).
  readonly redactFields: Readonly<Record<string, readonly string[]>>;
  // Exact, reviewed sys_properties names whose values may be versioned.
  readonly propertyValueAllowlist: readonly string[];
}

export const DEFAULT_REDACTION: RedactionPolicy = {
  // 2: typed property values are kept (ADR-0034).
  version: 2,
  redactFields: { sys_properties: ["value"] },
  // The vendor prefix new application scopes must start with: not a secret (ADR-0025).
  propertyValueAllowlist: ["glide.appcreator.company.code"],
};

export const SECRET_PROPERTY_NAME =
  /(?:^|[._-])(?:pass(?:word|wd)?|pwd|secret|client_?secret|api_?key|access_?token|auth_?token|refresh_?token|token|private_?key)$/i;

// The property types whose values are kept, each with the shape a value must have (ADR-0034).
// Such a value can hold a switch, a limit or a mode, never a credential.
const SHORT_LINE = /^[^\r\n]{1,40}$/;
const KEPT_PROPERTY_TYPES: Readonly<Record<string, RegExp>> = {
  boolean: /^(?:true|false)$/,
  integer: /^[+-]?\d{1,18}$/,
  choicelist: /^\S{1,80}$/,
  color: SHORT_LINE,
  date_format: SHORT_LINE,
  time_format: SHORT_LINE,
  timezone: SHORT_LINE,
};

export type PropertyValueVerdict = "kept" | "redacted" | "malformed";

// Whether a sys_properties row's value may reach the mirror. "malformed": its type is kept but
// the value doesn't have the type's shape, so it is redacted and counted.
export function propertyValueVerdict(row: Row, policy: RedactionPolicy): PropertyValueVerdict {
  const name = row["name"] ?? "";
  if (SECRET_PROPERTY_NAME.test(name)) {
    return "redacted";
  }
  if (policy.propertyValueAllowlist.includes(name)) {
    return "kept";
  }
  const shape = Object.hasOwn(KEPT_PROPERTY_TYPES, row["type"] ?? "")
    ? KEPT_PROPERTY_TYPES[row["type"] ?? ""]
    : undefined;
  if (shape === undefined || row["is_private"] !== "false") {
    return "redacted";
  }
  const value = row["value"] ?? "";
  if (value === "") {
    return "kept";
  }
  return shape.test(value) && redactSecrets(value) === value ? "kept" : "malformed";
}

// Fields of one record that must not reach disk. Matching ignores case.
export function fieldsToRedact(
  catalog: Catalog,
  table: string,
  row: Row,
  policy: RedactionPolicy,
): ReadonlySet<string> {
  const redact = new Set([...secretFields(catalog, table)].map((field) => field.toLowerCase()));
  for (const ancestor of catalog.ancestors(table)) {
    for (const field of policy.redactFields[ancestor] ?? []) {
      redact.add(field.toLowerCase());
    }
  }
  if (table === "sys_properties" && propertyValueVerdict(row, policy) === "kept") {
    redact.delete("value");
  }
  return redact;
}
