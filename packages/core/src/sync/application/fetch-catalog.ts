import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { CatalogData } from "../../metadata/domain/catalog";
import { SECRET_TYPES, TEXT_TYPE_EXTENSIONS } from "../../metadata/domain/field-rules";
import type { KeysetPager } from "./keyset-pager";

export interface CatalogProgress {
  readonly message: string;
}

async function list(
  pager: KeysetPager,
  table: string,
  fields: string[],
  base: string,
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of pager.rows(
    { table: TableName.parse(table), fields, kind: "snapshot", base },
    signal,
  )) {
    rows.push(row);
  }
  return rows;
}

function hierarchy(rows: readonly Row[]): Record<string, string | null> {
  const nameById = new Map(rows.map((row) => [row["sys_id"] ?? "", row["name"] ?? ""]));
  const parents: Record<string, string | null> = {};
  for (const row of rows) {
    parents[row["name"] ?? ""] = nameById.get(row["super_class"] ?? "") ?? null;
  }
  return parents;
}

function fieldTypes(rows: readonly Row[]): Record<string, Record<string, string>> {
  const typed: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    const table = row["name"] ?? "";
    typed[table] = { ...typed[table], [row["element"] ?? ""]: row["internal_type"] ?? "" };
  }
  return typed;
}

// Reads what the sync needs to know about the instance (about 17 requests on a PDI).
export async function fetchCatalog(
  pager: KeysetPager,
  signal: AbortSignal,
  progress: (event: CatalogProgress) => void = () => {},
): Promise<CatalogData> {
  progress({ message: "catalog: classes" });
  const classes = await list(pager, "sys_db_object", ["sys_id", "name", "super_class"], "", signal);
  progress({ message: "catalog: scopes" });
  const scopes = await list(pager, "sys_scope", ["sys_id", "scope"], "", signal);
  progress({ message: "catalog: field types" });
  // Only the types that decide whether a field becomes a file or is a secret.
  const types = [...Object.keys(TEXT_TYPE_EXTENSIONS), ...SECRET_TYPES].join(",");
  const fields = await list(
    pager,
    "sys_dictionary",
    ["sys_id", "name", "element", "internal_type"],
    `internal_typeIN${types}`,
    signal,
  );
  return {
    parents: hierarchy(classes),
    scopes: Object.fromEntries(scopes.map((row) => [row["sys_id"] ?? "", row["scope"] ?? ""])),
    typedFields: fieldTypes(fields),
  };
}
