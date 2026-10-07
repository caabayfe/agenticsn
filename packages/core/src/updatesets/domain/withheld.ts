import { isDeniedClass, SECRET_FIELD_NAMES } from "../../metadata/domain/field-rules";
import { SECRET_PROPERTY_NAME } from "../../metadata/domain/redaction";

// Secrets never reach disk, and an export is written to disk: an update whose payload holds
// one is left out whole. Blanking the value instead would import as an empty secret and
// silently break the target.
const TABLE = /<record_update\b[^>]*\btable="([^"]+)"/;
const SECRET_TYPE = /<type>\s*(?:password2?|encrypted_text)\s*<\/type>/i;

const element = (payload: string, name: string): string | undefined =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(payload)?.[1];

const filled = (value: string | undefined): boolean =>
  value !== undefined && value.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() !== "";

export function withheldReason(payload: string): string | null {
  const table = TABLE.exec(payload)?.[1] ?? "";
  if (isDeniedClass(table)) {
    return `${table} records hold credentials or certificates`;
  }
  const secret = SECRET_FIELD_NAMES.find((name) => filled(element(payload, name)));
  if (secret !== undefined) {
    return `it sets the secret field ${secret}`;
  }
  const property = element(payload, "name") ?? "";
  if (
    table === "sys_properties" &&
    (SECRET_PROPERTY_NAME.test(property) || SECRET_TYPE.test(payload))
  ) {
    return "it sets a secret-like property";
  }
  return null;
}
