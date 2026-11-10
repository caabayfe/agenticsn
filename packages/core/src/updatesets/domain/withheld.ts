import type { Catalog } from "../../metadata/domain/catalog";
import { holdsCredentialValue } from "../../metadata/domain/credential-values";
import { deniedAncestor, secretFields } from "../../metadata/domain/field-rules";
import { SECRET_PROPERTY_NAME } from "../../metadata/domain/redaction";
import { scanSecrets } from "../../metadata/domain/secret-scan";

// Secrets never reach disk, and an export is written to disk: an update whose payload holds
// one is left out whole. Blanking the value instead would import as an empty secret and
// silently break the target. The catalog holds the classes of the set's tables and their
// password-typed fields, read from the instance (spec 012, B-04, B-05).
const NAMED_TABLE = /<record_update\b[^>]*\btable="([^"]+)"/;
const FIRST_ELEMENT = /<record_update\b[^>]*>\s*<([A-Za-z0-9_]+)/;
const SECRET_TYPE = /<type>\s*(?:password2?|encrypted_text)\s*<\/type>/i;

// Composite updates whose first element is not a class: a table's dictionary, its choice
// lists, its form layout.
const NOT_CLASSES: ReadonlySet<string> = new Set([
  "database",
  "sys_choice_set",
  "sys_ui_form_sections",
]);

const element = (payload: string, name: string): string | undefined =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(payload)?.[1];

const unwrapped = (value: string | undefined): string | undefined =>
  value?.replace(/^<!\[CDATA\[|\]\]>$/g, "");

const filled = (value: string | undefined): boolean =>
  value !== undefined && (unwrapped(value) ?? "").trim() !== "";

export function payloadTable(payload: string): string | undefined {
  return NAMED_TABLE.exec(payload)?.[1] ?? FIRST_ELEMENT.exec(payload)?.[1];
}

// The class rules first, then the value scan pull and adopt apply (ADR-0035): a credential
// shape anywhere in the payload withholds the update. The reason names the pattern, never the
// value.
export function withheldReason(payload: string, catalog: Catalog): string | null {
  const reason = classReason(payload, catalog);
  if (reason !== null) return reason;
  const { patterns } = scanSecrets(payload);
  return patterns.length === 0
    ? null
    : `it holds a value shaped like a secret (${patterns.join(", ")})`;
}

function classReason(payload: string, catalog: Catalog): string | null {
  const table = payloadTable(payload);
  if (table === undefined) return "snagentic could not read the class of the record";
  if (NOT_CLASSES.has(table)) return null;
  // A class the instance didn't show may be one snagentic must not export.
  if (!catalog.knowsClass(table)) return `snagentic could not read the class of ${table}`;
  if (deniedAncestor(catalog, table) !== undefined) {
    return `${table} records hold credentials or certificates`;
  }
  const secret = [...secretFields(catalog, table)].find((name) => filled(element(payload, name)));
  if (secret !== undefined) {
    return `it sets the secret field ${secret}`;
  }
  const property = element(payload, "name") ?? "";
  if (
    holdsCredentialValue(catalog, table, unwrapped(property), unwrapped(element(payload, "value")))
  ) {
    return "it sets the value of a credential header or parameter";
  }
  if (
    table === "sys_properties" &&
    (SECRET_PROPERTY_NAME.test(property) || SECRET_TYPE.test(payload))
  ) {
    return "it sets a secret-like property";
  }
  return null;
}
