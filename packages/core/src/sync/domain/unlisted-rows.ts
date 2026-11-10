import type { Row } from "../../kernel/row";

function rowsOf(document: unknown): Row[] {
  if (!Array.isArray(document)) return [];
  return document.flatMap((item): Row[] =>
    item !== null && typeof item === "object"
      ? [Object.fromEntries(Object.entries(item).map(([key, value]) => [key, String(value)]))]
      : [],
  );
}

// ADR-0052 item 4, for the rows inside a child-row file: a user other than the mirror's keeps the
// rows its listing did not return, unless the instance's deletion records name them. Sorted by
// sys_id, as a pull writes them.
export function withUnlistedRows(
  listed: readonly Row[],
  mirrored: unknown,
  deleted: ReadonlySet<string>,
): Row[] {
  const seen = new Set(listed.map((row) => row["sys_id"] ?? ""));
  const kept = rowsOf(mirrored).filter((row) => {
    const sysId = row["sys_id"] ?? "";
    return !seen.has(sysId) && !deleted.has(sysId);
  });
  return [...listed, ...kept].sort((a, b) => ((a["sys_id"] ?? "") < (b["sys_id"] ?? "") ? -1 : 1));
}
