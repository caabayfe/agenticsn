import { AccessDeniedError } from "../../index-errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { OPERATIONAL_TABLES } from "../domain/pull-scope";
import type { PullDependencies } from "./pull-dependencies";

export interface OperationalOutcome {
  readonly operationalRows: number;
  readonly unreadable: readonly string[];
}

// Plugins, store applications and domains: one small YAML per table, curated fields only.
export async function pullOperational(
  deps: PullDependencies,
  signal: AbortSignal,
): Promise<OperationalOutcome> {
  let operationalRows = 0;
  const unreadable: string[] = [];
  for (const operational of OPERATIONAL_TABLES) {
    const rows: Row[] = [];
    const fields =
      operational.key === "sys_id" ? operational.fields : [...operational.fields, "sys_id"];
    try {
      for await (const row of deps.pager.rows(
        { table: TableName.parse(operational.table), fields, kind: "snapshot", base: "" },
        signal,
      )) {
        rows.push(Object.fromEntries(operational.fields.map((field) => [field, row[field] ?? ""])));
      }
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(operational.table);
      continue;
    }
    rows.sort((a, b) => ((a[operational.key] ?? "") < (b[operational.key] ?? "") ? -1 : 1));
    await deps.records.writeDocument(deps.operationalRoot, `${operational.table}.yaml`, rows);
    operationalRows += rows.length;
  }
  return { operationalRows, unreadable };
}
