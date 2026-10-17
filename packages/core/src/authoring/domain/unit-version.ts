import { sha256Hex } from "../../kernel/sha256";
import type { Fields } from "./unit";

// The fields that say whether anyone saved a record since.
export const VERSION_FIELDS = ["sys_id", "sys_mod_count", "sys_updated_on"] as const;

const stamp = (fields: Fields) =>
  `${fields["sys_mod_count"] ?? ""}|${fields["sys_updated_on"] ?? ""}`;

// A unit's version on the instance: its head's stamp, and its rows' (ADR-0033 item 3). Saving
// the unit in a designer, or any row of it, changes it. Push stamps what it loads, because a
// load alone does not (ADR-0030 item 5).
export function versionOf(head: Fields, rows: readonly Fields[]): string {
  if (rows.length === 0) return stamp(head);
  const material = rows
    .map((row) => `${row["sys_id"] ?? ""}:${stamp(row)}`)
    .sort()
    .join(";");
  return `${stamp(head)}|rows:${rows.length}:${sha256Hex(material).slice(0, 16)}`;
}
