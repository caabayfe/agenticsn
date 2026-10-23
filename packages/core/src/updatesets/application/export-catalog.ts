import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { Catalog } from "../../metadata/domain/catalog";
import { SECRET_TYPES } from "../../metadata/domain/field-rules";
import { payloadTable } from "../domain/withheld";
import { rowsWhereIn, type UpdateSetDependencies } from "./update-set-reads";

const SYS_DB_OBJECT = TableName.parse("sys_db_object");
const SYS_DICTIONARY = TableName.parse("sys_dictionary");
const CLASS_FIELDS = ["sys_id", "name", "super_class"];

// Only plain names and sys_ids go into a query: a payload can name anything (spec 012, B-12).
const PLAIN_NAME = /^[a-z0-9_]+$/;
const SYS_ID = /^[0-9a-f]{32}$/;

interface Classes {
  readonly nameById: Map<string, string>;
  // Class name -> its parent's sys_id ("" for a root).
  readonly parentId: Map<string, string>;
}

// The tables' classes and every ancestor: one listing per level of the hierarchy.
async function classChains(
  deps: UpdateSetDependencies,
  tables: readonly string[],
  signal: AbortSignal,
): Promise<Classes> {
  const classes: Classes = { nameById: new Map(), parentId: new Map() };
  const asked = new Set<string>();
  let rows: Row[] = await rowsWhereIn(deps, SYS_DB_OBJECT, "name", tables, CLASS_FIELDS, signal);
  while (rows.length > 0) {
    for (const row of rows) {
      classes.nameById.set(row["sys_id"] ?? "", row["name"] ?? "");
      classes.parentId.set(row["name"] ?? "", row["super_class"] ?? "");
    }
    const next = [...new Set(classes.parentId.values())].filter(
      (id) => SYS_ID.test(id) && !classes.nameById.has(id) && !asked.has(id),
    );
    for (const id of next) asked.add(id);
    rows = await rowsWhereIn(deps, SYS_DB_OBJECT, "sys_id", next, CLASS_FIELDS, signal);
  }
  return classes;
}

// Parents of the classes whose whole chain was read. A class with an ancestor the user can't
// read is left out, so the export withholds its updates: that ancestor may be a credential class.
function completeParents(classes: Classes): Record<string, string | null> {
  const complete = (name: string, seen: readonly string[] = []): boolean => {
    const id = classes.parentId.get(name) ?? "";
    if (id === "") return true;
    const parent = classes.nameById.get(id);
    return parent !== undefined && !seen.includes(parent) && complete(parent, [...seen, name]);
  };
  const parents: Record<string, string | null> = {};
  for (const [name, id] of classes.parentId) {
    if (complete(name)) parents[name] = classes.nameById.get(id) ?? null;
  }
  return parents;
}

// What the export needs to withhold secrets (spec 012, B-04): the classes of the tables the set
// touches, up to their roots, and the fields the dictionary types as passwords on any of them.
export async function exportCatalog(
  deps: UpdateSetDependencies,
  payloads: readonly string[],
  signal: AbortSignal,
): Promise<Catalog> {
  const tables = [...new Set(payloads.map(payloadTable))].filter(
    (table): table is string => table !== undefined && PLAIN_NAME.test(table),
  );
  const parents = completeParents(await classChains(deps, tables, signal));
  const typed = await rowsWhereIn(
    deps,
    SYS_DICTIONARY,
    "name",
    Object.keys(parents),
    ["sys_id", "name", "element", "internal_type"],
    signal,
    `internal_typeIN${[...SECRET_TYPES].join(",")}`,
  );
  const typedFields: Record<string, Record<string, string>> = {};
  for (const row of typed.filter((r) => SECRET_TYPES.has(r["internal_type"] ?? ""))) {
    const table = row["name"] ?? "";
    typedFields[table] = {
      ...typedFields[table],
      [row["element"] ?? ""]: row["internal_type"] ?? "",
    };
  }
  return new Catalog({ parents, scopes: {}, typedFields });
}
