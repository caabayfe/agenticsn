import type { TableStatistics } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { SysId } from "../../kernel/sys-id";
import { TableName } from "../../kernel/table-name";
import type { KeysetPager } from "../../sync/application/keyset-pager";
import { chunks } from "../../sync/domain/record-changes";
import type { Application } from "../domain/export-mapping";

export interface UpdateSetDependencies {
  readonly pager: KeysetPager;
  readonly statistics: TableStatistics;
  readonly now: () => Date;
}

export const SYS_UPDATE_SET = TableName.parse("sys_update_set");
export const SYS_UPDATE_XML = TableName.parse("sys_update_xml");
const SYS_SCOPE = TableName.parse("sys_scope");
// Keys per IN query, so the URL stays short.
const IN_BATCH = 100;

export const SET_FIELDS = [
  "sys_id",
  "name",
  "state",
  "application",
  "is_default",
  "description",
  "sys_created_by",
  "sys_updated_on",
];

export async function listRows(
  deps: UpdateSetDependencies,
  table: TableName,
  base: string,
  fields: readonly string[] | "all",
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of deps.pager.rows({ table, fields, kind: "snapshot", base }, signal)) {
    rows.push(row);
  }
  return rows;
}

// Rows whose `field` is one of `keys`, in IN queries of at most IN_BATCH keys.
export async function rowsWhereIn(
  deps: UpdateSetDependencies,
  table: TableName,
  field: string,
  keys: readonly string[],
  fields: readonly string[] | "all",
  signal: AbortSignal,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const batch of chunks([...new Set(keys)], IN_BATCH)) {
    rows.push(...(await listRows(deps, table, `${field}IN${batch.join(",")}`, fields, signal)));
  }
  return rows;
}

export async function applications(
  deps: UpdateSetDependencies,
  ids: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, Application>> {
  const fields = ["sys_id", "name", "scope", "version"];
  const rows = await rowsWhereIn(deps, SYS_SCOPE, "sys_id", ids.filter(Boolean), fields, signal);
  return new Map(
    rows.map((row) => [
      row["sys_id"] ?? "",
      {
        sysId: row["sys_id"] ?? "",
        name: row["name"] ?? "",
        scope: row["scope"] ?? "",
        version: row["version"] ?? "",
      },
    ]),
  );
}

export async function updateCounts(
  deps: UpdateSetDependencies,
  setIds: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const batch of chunks(setIds, IN_BATCH)) {
    const query = `update_setIN${batch.join(",")}`;
    for (const [id, count] of await deps.statistics.countBy(
      SYS_UPDATE_XML,
      "update_set",
      signal,
      query,
    )) {
      counts.set(id, count);
    }
  }
  return counts;
}

export function validSysId(value: string): string {
  return SysId.parse(value);
}
