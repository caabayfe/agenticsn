import { HASH_EXCLUDED_FIELDS } from "../../kernel/record-hash";
import { CHILD_TABLES, EDITABLE_CHILD_TABLES } from "../../metadata/domain/child-tables";
import type { PlannedWrite, PlanProblem } from "./change";

// The record whose file holds the rows: a form section for its fields, a list for its
// columns, a table (sys_db_object) for its choices.
export interface RowOwner {
  readonly table: string;
  readonly sysId: string;
  readonly scope: string;
  // The owner's name field: for a table, the name its choices refer to.
  readonly name: string;
}

type Row = Readonly<Record<string, string>>;

const SYS_ID = /^[0-9a-f]{32}$/;
const CHILD_FILE = /\.children\.([^/]+)\.yaml$/;

// How to retire a row, as push never deletes (spec 004, D2).
const RETIRE: Readonly<Record<string, string>> = {
  sys_choice: "set inactive to true instead, and keep the row",
};
const REMOVE_ON_INSTANCE = "remove it on the instance, then pull and integrate";

function rowsOf(document: unknown): Row[] | null {
  if (document === null) {
    return [];
  }
  if (!Array.isArray(document)) {
    return null;
  }
  return document.map((item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).map(([key, value]) => [key, value === null ? "" : String(value)]),
        )
      : {},
  );
}

const content = (row: Row): Record<string, string> =>
  Object.fromEntries(Object.entries(row).filter(([field]) => !HASH_EXCLUDED_FIELDS.has(field)));

// Any change on the instance raises the modification count and the update time.
const version = (row: Row) => `${row["sys_mod_count"] ?? ""}|${row["sys_updated_on"] ?? ""}`;

function changed(before: Row, now: Row): Record<string, string> {
  const was = content(before);
  const is = content(now);
  const values: Record<string, string> = {};
  for (const field of [...new Set([...Object.keys(was), ...Object.keys(is)])].sort()) {
    if ((is[field] ?? "") !== (was[field] ?? "")) {
      values[field] = is[field] ?? "";
    }
  }
  return values;
}

interface RowContext {
  readonly path: string;
  readonly table: string;
  readonly parentField: string;
  readonly ownerKey: string;
  readonly owner: RowOwner;
}

function rowProblem(context: RowContext, row: Row): string | null {
  const sysId = row["sys_id"] ?? "";
  if (!SYS_ID.test(sysId)) {
    return `a row has sys_id "${sysId}": give each new row a new 32-character hex sys_id`;
  }
  if ((row[context.parentField] ?? "") !== context.ownerKey) {
    return `row ${sysId}: ${context.parentField} must be ${context.ownerKey}, the record whose file holds it`;
  }
  return null;
}

function writeOf(context: RowContext, before: Row | undefined, now: Row): PlannedWrite | null {
  const values = before === undefined ? content(now) : changed(before, now);
  if (Object.keys(values).length === 0) {
    return null;
  }
  const { owner, table } = context;
  return {
    operation: before === undefined ? "create" : "update",
    table,
    sysId: now["sys_id"] ?? "",
    scope: owner.scope,
    path: context.path,
    values,
    baseHash: before === undefined ? null : version(before),
    owner: { table: owner.table, sysId: owner.sysId },
    updateName:
      table === "sys_choice" ? `sys_choice_${now["name"] ?? ""}_${now["element"] ?? ""}` : null,
  };
}

// What a child-row file's edit means for the instance (ADR-0025): new rows are created,
// changed rows updated field by field; removed rows are refused.
export function childRowChanges(
  path: string,
  owner: RowOwner | null,
  before: unknown,
  now: unknown,
): { writes: PlannedWrite[]; problems: PlanProblem[] } {
  const table = CHILD_FILE.exec(path)?.[1] ?? "";
  const child = CHILD_TABLES.find((candidate) => candidate.table === table);
  const fail = (reason: string) => ({ writes: [], problems: [{ path, reason }] });
  if (child === undefined || !EDITABLE_CHILD_TABLES.has(table)) {
    return fail(`child rows of ${table} are read-only: change the record that owns them`);
  }
  if (owner === null) {
    return fail(
      "the owning record is missing: rows are pushed with the record whose file holds them",
    );
  }
  const [was, is] = [rowsOf(before), rowsOf(now)];
  if (was === null || is === null) {
    return fail("the file must hold a list of rows");
  }
  const ownerKey = child.ownedByTableName === true ? owner.name : owner.sysId;
  const context = { path, table, parentField: child.parentField, ownerKey, owner };
  const bySysId = new Map(was.map((row) => [row["sys_id"] ?? "", row]));
  const kept = new Set(is.map((row) => row["sys_id"] ?? ""));
  const problems: PlanProblem[] = was
    .filter((row) => !kept.has(row["sys_id"] ?? ""))
    .map((row) => ({
      path,
      reason: `row ${row["sys_id"] ?? ""} was removed; push never deletes: ${RETIRE[table] ?? REMOVE_ON_INSTANCE}`,
    }));
  const writes: PlannedWrite[] = [];
  for (const row of is) {
    const reason = rowProblem(context, row);
    const write = reason === null ? writeOf(context, bySysId.get(row["sys_id"] ?? ""), row) : null;
    if (reason !== null) {
      problems.push({ path, reason });
    } else if (write !== null) {
      writes.push(write);
    }
  }
  return { writes, problems };
}
