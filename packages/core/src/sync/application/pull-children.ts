import { AccessDeniedError } from "../../index-errors";
import { canonicalText } from "../../kernel/canonical-text";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { fieldsToRedact } from "../../metadata/domain/redaction";
import { attachChildren, CHILD_TABLES, ownerOfBase } from "../domain/pull-scope";
import type { PullDependencies } from "./pull-dependencies";

export interface ChildrenOutcome {
  readonly childRows: number;
  readonly orphanChildRows: number;
  readonly unreadable: readonly string[];
}

function cleaned(row: Row, redact: ReadonlySet<string>): Row {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([field]) => !redact.has(field.toLowerCase()))
      .map(([field, value]) => [field, canonicalText(value)]),
  );
}

async function owners(deps: PullDependencies): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for await (const base of deps.records.bases(deps.metadataRoot)) {
    map.set(ownerOfBase(base), base);
  }
  return map;
}

async function rowsOf(deps: PullDependencies, table: string, signal: AbortSignal): Promise<Row[]> {
  const rows: Row[] = [];
  for await (const row of deps.pager.rows(
    { table: TableName.parse(table), fields: "all", kind: "snapshot", base: "" },
    signal,
  )) {
    rows.push(row);
  }
  return rows;
}

// Child rows (flow logic, layouts, workflow structure) live next to their owning record.
export async function pullChildren(
  deps: PullDependencies,
  catalog: Catalog,
  signal: AbortSignal,
): Promise<ChildrenOutcome> {
  const ownerMap = await owners(deps);
  const unreadable: string[] = [];
  let childRows = 0;
  let orphanChildRows = 0;
  for (const child of CHILD_TABLES) {
    let rows: Row[];
    try {
      rows = await rowsOf(deps, child.table, signal);
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) {
        throw error;
      }
      unreadable.push(child.table);
      continue;
    }
    const redact = fieldsToRedact(catalog, child.table, "", deps.policy);
    const grouped = attachChildren(
      rows.map((row) => cleaned(row, redact)),
      child.parentField,
      ownerMap,
    );
    for (const [base, list] of grouped.attached) {
      await deps.records.writeDocument(
        deps.metadataRoot,
        `${base}.children.${child.table}.yaml`,
        list,
      );
      childRows += list.length;
    }
    orphanChildRows += grouped.orphans;
  }
  return { childRows, orphanChildRows, unreadable };
}
