import { formatRawTimestamp } from "../../kernel/raw-timestamp";

// A load keeps a record's sys_mod_count and sys_updated_on unless the update gives them, and
// pull finds changes by those (ADR-0030 item 5; S16 F2 for the SDK's output). Push stamps the
// head record of each unit it loads, as a save would.

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function setField(element: string, field: string, value: string): string {
  const existing = new RegExp(`<${field}(\\s[^>]*)?(/>|>[^<]*</${field}>)`);
  const replacement = `<${field}>${value}</${field}>`;
  if (existing.test(element)) return element.replace(existing, replacement);
  return element.replace(/(<sys_id>[^<]*<\/sys_id>)/, `$1${replacement}`);
}

// The built XML with its head record (the first `<table action=...>` element) stamped.
export function stampedXml(xml: string, table: string, modCount: string, now: Date): string {
  const head = new RegExp(
    `<${escapeRegex(table)}\\s[^>]*action="[A-Z_]+"[^>]*>[\\s\\S]*?</${escapeRegex(table)}>`,
  );
  const match = head.exec(xml);
  if (match === null) return xml;
  const updatedOn = formatRawTimestamp(now.getTime());
  const stamped = setField(
    setField(match[0], "sys_mod_count", modCount),
    "sys_updated_on",
    updatedOn,
  );
  return xml.slice(0, match.index) + stamped + xml.slice(match.index + match[0].length);
}

// The mod count a load gives a record: one more than the instance's, or 0 for a new record.
export const nextCount = (current: string | undefined) =>
  current === undefined ? "0" : String((Number(current) || 0) + 1);
