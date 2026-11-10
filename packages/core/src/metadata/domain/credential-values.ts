import { canonicalText } from "../../kernel/canonical-text";
import { recordHash } from "../../kernel/record-hash";
import type { Catalog } from "./catalog";

// Rows that hold one HTTP header or parameter of an outbound message as a `name` and a `value`
// field. The value scan can't recognize a credential there: the header name that gives it away
// is in another field (spec 014, SEC2-02). Measured on pdi2: a SOAP parameter held a cloud key.
const NAME_VALUE_TABLES: ReadonlySet<string> = new Set([
  "sys_rest_message_headers",
  "sys_rest_message_fn_headers",
  "sys_rest_message_fn_parameters",
  "sys_rest_message_fn_param_defs",
  "sys_soap_message_parameters",
]);

// Header and parameter names whose value is a credential.
const CREDENTIAL_NAME =
  /^(?:(?:proxy-)?authorization|cookie|.*(?:api|access|auth|subscription|private|secret)[-_.]?key.*|.*token.*|.*secret.*|.*passw(?:or)?d.*|.*pwd.*|.*credential.*)$/i;

// A value made only of variable substitutions (`Bearer ${token}`) holds no credential itself.
const SUBSTITUTION_ONLY = /^(?:[A-Za-z-]+\s+)?(?:\$\{[\w.-]+\}\s*)+$/;

export const CREDENTIAL_VALUE_FIELD = "value";

export function isNameValueTable(catalog: Catalog, table: string): boolean {
  return catalog.ancestors(table).some((ancestor) => NAME_VALUE_TABLES.has(ancestor));
}

// Whether a header or parameter row's value must not be written: its name says it is a
// credential and the value isn't empty or a substitution.
export function holdsCredentialValue(
  catalog: Catalog,
  table: string,
  name: string | undefined,
  value: string | undefined,
): boolean {
  const text = value?.trim() ?? "";
  return (
    isNameValueTable(catalog, table) &&
    CREDENTIAL_NAME.test(name?.trim() ?? "") &&
    text !== "" &&
    !SUBSTITUTION_ONLY.test(text)
  );
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

// A committed record file that holds such a value, rewritten as a pull now writes it: the value
// left out, named in `_meta.redacted`, and the hash taken over the fields that remain. Null when
// the document needs no change. Name/value rows have no field files, so the document holds
// every content field.
export function withoutCredentialValue(
  document: unknown,
  catalog: Catalog,
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(document) || !isRecord(document["_meta"])) return null;
  const meta = document["_meta"];
  const table = text(meta["sys_class_name"]);
  const field = CREDENTIAL_VALUE_FIELD;
  if (!holdsCredentialValue(catalog, table, text(document["name"]), text(document[field]))) {
    return null;
  }
  const kept = Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== "_meta" && key !== field),
  );
  const fields = Object.fromEntries(
    Object.entries(kept).map(([key, value]) => [key, canonicalText(text(value))]),
  );
  const listed = Array.isArray(meta["redacted"]) ? meta["redacted"].map(String) : [];
  const redacted = [...new Set([...listed, field])].sort();
  return {
    _meta: { ...meta, hash: recordHash(table, fields), redacted },
    ...kept,
  };
}
