import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { canonicalJson } from "./canonical-json";
import { canonicalText } from "./canonical-text";

// Identity and provenance fields: never part of the content hash (v1 META_FIELDS).
export const HASH_EXCLUDED_FIELDS: ReadonlySet<string> = new Set([
  "sys_id",
  "sys_class_name",
  "sys_mod_count",
  "sys_updated_on",
  "sys_updated_by",
  "sys_created_on",
  "sys_created_by",
  "sys_update_name",
  "sys_scope",
  "sys_domain",
  "sys_domain_path",
  "sys_package",
  "sys_tags",
]);

// Hash contract v1 (ADR-0007):
// sha256(canonical_json({"class": class, "fields": {k: canonical_text(v)}})), hex encoded.
export function recordHash(
  className: string,
  fields: Readonly<Record<string, string | null>>,
): string {
  const canonicalFields = Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, canonicalText(value)]),
  );
  const material = canonicalJson({ class: className, fields: canonicalFields });
  return bytesToHex(sha256(utf8ToBytes(material)));
}
