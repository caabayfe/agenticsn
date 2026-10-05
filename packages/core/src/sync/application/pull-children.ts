import { AccessDeniedError } from "../../index-errors";
import { canonicalText } from "../../kernel/canonical-text";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import type { Catalog } from "../../metadata/domain/catalog";
import { fieldsToRedact } from "../../metadata/domain/redaction";
import {
  type AttachedChildren,
  CHILD_TABLES,
  type ChildTable,
  childGrouper,
  ownerOfBase,
} from "../domain/pull-scope";
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

// Streams one child table straight into its groups: rows are cleaned as they arrive and the
// table is never held twice. Returns null when the user may not read the table.
async function groupTable(
  deps: PullDependencies,
  catalog: Catalog,
  child: ChildTable,
  owners: Map<string, string>,
  signal: AbortSignal,
): Promise<AttachedChildren | null> {
  const redact = fieldsToRedact(catalog, child.table, "", deps.policy);
  const grouper = childGrouper(child.parentField, owners);
  const listing = {
    table: TableName.parse(child.table),
    fields: "all" as const,
    kind: "snapshot" as const,
    base: "",
  };
  try {
    for await (const row of deps.pager.rows(listing, signal)) {
      grouper.add(cleaned(row, redact));
    }
  } catch (error) {
    if (!(error instanceof AccessDeniedError)) {
      throw error;
    }
    return null;
  }
  return grouper.result();
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
    const grouped = await groupTable(deps, catalog, child, ownerMap, signal);
    if (grouped === null) {
      unreadable.push(child.table);
      continue;
    }
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
