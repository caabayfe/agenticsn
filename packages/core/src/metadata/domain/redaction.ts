import type { Catalog } from "./catalog";
import { secretFields } from "./field-rules";

export interface RedactionPolicy {
  // Table -> fields whose values are never written (applies to subclasses too).
  readonly redactFields: Readonly<Record<string, readonly string[]>>;
  // Exact, reviewed sys_properties names whose values may be versioned.
  readonly propertyValueAllowlist: readonly string[];
}

export const DEFAULT_REDACTION: RedactionPolicy = {
  redactFields: { sys_properties: ["value"] },
  propertyValueAllowlist: [],
};

export const SECRET_PROPERTY_NAME =
  /(?:^|[._-])(?:pass(?:word|wd)?|pwd|secret|client_?secret|api_?key|access_?token|auth_?token|refresh_?token|token|private_?key)$/i;

// Fields of one record that must not reach disk. Matching ignores case.
export function fieldsToRedact(
  catalog: Catalog,
  table: string,
  recordName: string,
  policy: RedactionPolicy,
): ReadonlySet<string> {
  const redact = new Set([...secretFields(catalog, table)].map((field) => field.toLowerCase()));
  for (const ancestor of catalog.ancestors(table)) {
    for (const field of policy.redactFields[ancestor] ?? []) {
      redact.add(field.toLowerCase());
    }
  }
  const allowlisted = policy.propertyValueAllowlist.includes(recordName);
  if (table === "sys_properties" && allowlisted && !SECRET_PROPERTY_NAME.test(recordName)) {
    redact.delete("value");
  }
  return redact;
}
