import type { InstanceReader } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";
import { AdoptRecordsNotFoundError, AdoptStoreApplicationError } from "../domain/adopt-errors";
import type { TransformTarget } from "../ports";

// Where records live on the instance before adopt converts them: their class and application.

export interface Located {
  readonly target: TransformTarget;
  readonly scope: { readonly name: string; readonly sysId: string };
}

async function rows(
  pager: KeysetPager,
  table: string,
  ids: readonly string[],
  fields: string[],
  signal: AbortSignal,
) {
  const found: Row[] = [];
  const listing = {
    kind: "snapshot" as const,
    table: TableName.parse(table),
    base: `sys_idIN${ids.join(",")}`,
    fields,
  };
  for await (const row of pager.rows(listing, signal)) found.push(row);
  return found;
}

// Each record's class and application, as the instance holds them now.
export async function locate(
  reader: InstanceReader,
  targets: readonly TransformTarget[],
  signal: AbortSignal,
): Promise<Located[]> {
  const pager = new KeysetPager(reader);
  const ids = targets.map((t) => t.sysId);
  const records = await rows(
    pager,
    "sys_metadata",
    ids,
    ["sys_id", "sys_class_name", "sys_scope"],
    signal,
  );
  const missing = targets.filter((t) => !records.some((r) => r["sys_id"] === t.sysId));
  if (missing.length > 0)
    throw new AdoptRecordsNotFoundError(missing.map((t) => `${t.table}:${t.sysId}`));
  const scopeIds = [...new Set(records.map((r) => r["sys_scope"] ?? "global"))];
  const scopes = await rows(
    pager,
    "sys_scope",
    scopeIds,
    ["sys_id", "scope", "sys_class_name"],
    signal,
  );
  const store = scopes.find((s) => s["sys_class_name"] === "sys_store_app");
  if (store !== undefined) throw new AdoptStoreApplicationError(store["scope"] ?? "");
  return records.map((record) => {
    const scopeId = record["sys_scope"] ?? "global";
    const scope = scopes.find((s) => s["sys_id"] === scopeId);
    return {
      target: { table: record["sys_class_name"] ?? "", sysId: record["sys_id"] ?? "" },
      scope: { name: scope?.["scope"] ?? "global", sysId: scopeId },
    };
  });
}
