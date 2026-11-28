import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { KeysetPager } from "../../sync";

// Reads what the instance says about the tables a plan writes: their ancestry, one level per
// request (ADR-0016), for the checks that depend on what a table inherits.

export async function listRows(
  pager: KeysetPager,
  table: string,
  base: string,
  fields: readonly string[],
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  const listing = { kind: "snapshot" as const, table: TableName.parse(table), base, fields };
  for await (const row of pager.rows(listing, signal)) rows.push(row);
  return rows;
}

export interface TableAncestry {
  // Each table's parent, for the tables that have one.
  readonly parents: ReadonlyMap<string, string>;
  // The tables the instance describes, the asked ones and their ancestors, whose parent (if any)
  // it names: a parent given by sys_id alone leaves the table's ancestry unknown.
  readonly known: ReadonlySet<string>;
}

// Records one sys_db_object row; answers the parent still to read, if any.
function record(
  row: Row,
  parents: Map<string, string>,
  known: Set<string>,
  asked: readonly string[],
): string | null {
  const name = row["name"] ?? "";
  const parent = row["super_class.name"] ?? "";
  if (parent !== "" || (row["super_class"] ?? "") === "") known.add(name);
  if (parent === "" || parents.has(name)) return null;
  parents.set(name, parent);
  const unread = !parents.has(parent) && !asked.includes(parent) && !known.has(parent);
  return unread ? parent : null;
}

export async function tableAncestry(
  pager: KeysetPager,
  tables: readonly string[],
  signal: AbortSignal,
): Promise<TableAncestry> {
  const parents = new Map<string, string>();
  const known = new Set<string>();
  let level = [...tables];
  while (level.length > 0) {
    const rows = await listRows(
      pager,
      "sys_db_object",
      `nameIN${level.join(",")}`,
      ["sys_id", "name", "super_class", "super_class.name"],
      signal,
    );
    level = rows.flatMap((row) => record(row, parents, known, tables) ?? []);
  }
  return { parents, known };
}
