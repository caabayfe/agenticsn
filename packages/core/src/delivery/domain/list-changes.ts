import { HASH_EXCLUDED_FIELDS } from "../../kernel/record-hash";
import type { Operation, ParsedRecord, PlanProblem } from "./change";
import type { ListColumn, ListLayout } from "./list-layout";
import { listUpdateName } from "./list-layout";

// A list layout edit, planned as the whole list (ADR-0029): push loads it as one List Layout
// update, which the platform records, instead of writing rows it would not record. Pure.

export interface ListFiles {
  readonly record: ParsedRecord;
  // The columns file (<list>.children.sys_ui_list_element.yaml), parsed; null when absent.
  readonly rows: unknown;
}

export interface PlannedList {
  readonly operation: Operation;
  // The list record's file, relative to the metadata root.
  readonly path: string;
  readonly scope: string;
  readonly updateName: string;
  readonly layout: ListLayout;
  // Versions as pulled (sys_mod_count|sys_updated_on) of the list and of each column, by
  // sys_id; push stops if the instance's differ. Null for a new list.
  readonly base: {
    readonly list: string;
    readonly columns: Readonly<Record<string, string>>;
  } | null;
}

type Row = Readonly<Record<string, string>>;

const SYS_ID = /^[0-9a-f]{32}$/;
const FLAGS = ["sum", "max_value", "min_value", "average_value"] as const;
const CARRIED = new Set(["list_id", "element", "position", ...FLAGS]);
const CARRIED_TEXT = "element, position, sum, max_value, min_value and average_value";
const IDENTITY = ["name", "view"] as const;

// Any change on the instance raises the modification count and the update time.
export const listVersion = (fields: Readonly<Record<string, string | undefined>>) =>
  `${fields["sys_mod_count"] ?? ""}|${fields["sys_updated_on"] ?? ""}`;

function rowsOf(document: unknown): Row[] | null {
  if (document === null) return [];
  if (!Array.isArray(document)) return null;
  return document.map((item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).map(([key, value]) => [key, value === null ? "" : String(value)]),
        )
      : {},
  );
}

const content = (row: Row) =>
  JSON.stringify(
    Object.entries(row)
      .filter(([field]) => !HASH_EXCLUDED_FIELDS.has(field))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

function listProblems(before: ListFiles | null, after: ListFiles): string[] {
  const now = after.record.artifact;
  if ((now.fields["sys_user"] ?? "") !== "") {
    return ["personal list layouts (sys_user set) are never pushed"];
  }
  if (["parent", "relationship", "element"].some((f) => (now.fields[f] ?? "") !== "")) {
    return [
      "related list layouts (parent, relationship or element set) are not pushed yet: change them on the instance",
    ];
  }
  if (before === null) return [];
  const was = before.record.artifact;
  const identity = [
    ...IDENTITY.filter((f) => (was.fields[f] ?? "") !== (now.fields[f] ?? "")),
    ...(was.identity.domain === now.identity.domain ? [] : ["domain"]),
  ];
  return identity.map(
    (f) => `${f} changed: a list's table, view and domain identify it; add a new list file instead`,
  );
}

function rowProblems(listId: string, rows: readonly Row[], before: ReadonlyMap<string, Row>) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const sysId = row["sys_id"] ?? "";
    if (!SYS_ID.test(sysId)) {
      problems.push(
        `a column has sys_id "${sysId}": give each new column a new 32-character hex sys_id`,
      );
      continue;
    }
    const was = before.get(sysId) ?? {};
    const label = `column ${sysId}`;
    if ((row["list_id"] ?? "") !== listId) {
      problems.push(`${label}: list_id must be ${listId}, the list whose file holds it`);
    }
    const element = row["element"] ?? "";
    if (seen.has(element)) problems.push(`${label}: ${element} is listed twice`);
    seen.add(element);
    for (const flag of FLAGS.filter((f) => !["true", "false"].includes(row[f] ?? "false"))) {
      problems.push(`${label}: ${flag} must be true or false`);
    }
    const uncarried = Object.keys(row).filter(
      (f) => !CARRIED.has(f) && !HASH_EXCLUDED_FIELDS.has(f) && (row[f] ?? "") !== (was[f] ?? ""),
    );
    for (const field of uncarried.sort()) {
      problems.push(`${label}: ${field} cannot be pushed; a list layout carries ${CARRIED_TEXT}`);
    }
  }
  return problems;
}

const columnOf = (row: Row): ListColumn => ({
  sysId: row["sys_id"] ?? "",
  element: row["element"] ?? "",
  position: row["position"] ?? "",
  sum: row["sum"] || "false",
  maxValue: row["max_value"] || "false",
  minValue: row["min_value"] || "false",
  averageValue: row["average_value"] || "false",
});

function unchanged(before: ListFiles, after: ListFiles, was: readonly Row[], is: readonly Row[]) {
  const fields = (files: ListFiles) =>
    JSON.stringify([
      ...IDENTITY.map((f) => files.record.artifact.fields[f] ?? ""),
      files.record.artifact.identity.domain,
    ]);
  const rows = (all: readonly Row[]) => all.map(content).sort().join("\n");
  return fields(before) === fields(after) && rows(was) === rows(is);
}

// What one list's edit means for the instance. `view` names the list's view (its sys_id and
// name), as the mirror holds it.
export function listChange(
  path: string,
  before: ListFiles | null,
  after: ListFiles | null,
  view: ListLayout["view"],
): { readonly list: PlannedList | null; readonly problems: readonly PlanProblem[] } {
  const fail = (reasons: readonly string[]) => ({
    list: null,
    problems: reasons.map((reason) => ({ path, reason })),
  });
  if (after === null) {
    return before === null
      ? fail([])
      : fail([
          "deleting a list layout is not supported: restore the file, and remove columns instead",
        ]);
  }
  const [was, is] = [rowsOf(before?.rows ?? null), rowsOf(after.rows)];
  if (was === null || is === null) return fail(["the columns file must hold a list of rows"]);
  const { identity, fields } = after.record.artifact;
  const pulled = new Map(was.map((row) => [row["sys_id"] ?? "", row]));
  const problems = [...listProblems(before, after), ...rowProblems(identity.sysId, is, pulled)];
  if (problems.length > 0) return fail(problems);
  if (before !== null && unchanged(before, after, was, is)) return fail([]);
  const layout: ListLayout = {
    sysId: identity.sysId,
    table: fields["name"] ?? "",
    view,
    domain: identity.domain,
    columns: is.map(columnOf),
  };
  const base =
    before === null
      ? null
      : {
          list: listVersion(before.record.artifact.meta),
          columns: Object.fromEntries(was.map((row) => [row["sys_id"] ?? "", listVersion(row)])),
        };
  return {
    list: {
      operation: before === null ? "create" : "update",
      path,
      scope: identity.scope,
      updateName: before?.record.artifact.meta["sys_update_name"] || listUpdateName(layout),
      layout,
      base,
    },
    problems: [],
  };
}
