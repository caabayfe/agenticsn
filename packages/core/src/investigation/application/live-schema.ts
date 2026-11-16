import type { InstanceReader } from "../../connection/index";
import { InvalidInputError } from "../../kernel/errors";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/index";
import { assertReadableTable, type LiveField, type LiveSchema } from "../domain/query-policy";

async function definition(
  reader: InstanceReader,
  query: string,
  signal: AbortSignal,
): Promise<Row> {
  const rows = await reader.query(
    {
      table: TableName.parse("sys_db_object"),
      query,
      fields: ["sys_id", "name", "super_class"],
      limit: 2,
    },
    signal,
  );
  if (rows.length !== 1 || !rows[0])
    throw new InvalidInputError(
      "table definition is missing, ambiguous or not visible to this credential",
    );
  return rows[0];
}

export async function readLiveSchema(
  reader: InstanceReader,
  table: TableName,
  signal: AbortSignal,
): Promise<LiveSchema> {
  assertReadableTable(table);
  const ancestors: string[] = [];
  const fields = new Map<string, LiveField>();
  const pager = new KeysetPager(reader, { initialPageSize: 100, adaptive: false });
  let current: Row | null = await definition(reader, `name=${table}`, signal);
  while (current !== null) {
    signal.throwIfAborted();
    const name = TableName.parse(current["name"] ?? "");
    assertReadableTable(name);
    if (ancestors.includes(name) || ancestors.length >= 12)
      throw new InvalidInputError("schema inheritance is cyclic or exceeds 12 levels");
    ancestors.push(name);
    await declaredFields(pager, name, fields, signal);
    const parent = parentId(current);
    current = parent === "" ? null : await definition(reader, `sys_id=${parent}`, signal);
  }
  if (fields.size === 0)
    throw new InvalidInputError(
      "dictionary is not visible; cannot safely validate or redact live records",
    );
  if (!fields.has("sys_id"))
    fields.set("sys_id", {
      name: "sys_id",
      type: "GUID",
      reference: "",
      unique: true,
      declaredOn: table,
    });
  return {
    table,
    ancestors,
    fields: [...fields.values()].sort((a, b) => a.name.localeCompare(b.name)),
    complete: true,
  };
}

async function declaredFields(
  pager: KeysetPager,
  table: TableName,
  fields: Map<string, LiveField>,
  signal: AbortSignal,
): Promise<void> {
  let count = 0;
  for await (const row of pager.rows(
    {
      table: TableName.parse("sys_dictionary"),
      kind: "snapshot",
      base: `name=${table}^elementISNOTEMPTY`,
      fields: ["sys_id", "element", "internal_type", "reference", "unique"],
    },
    signal,
  )) {
    const element = row["element"] ?? "";
    if (!/^[a-z][a-z0-9_]*$/.test(element) || !(row["internal_type"] ?? ""))
      throw new InvalidInputError("dictionary fields are incomplete for this credential");
    if (!fields.has(element))
      fields.set(element, {
        name: element,
        type: row["internal_type"] ?? "",
        reference: row["reference"] ?? "",
        unique: row["unique"] === "true",
        declaredOn: table,
      });
    if (++count > 4000 || fields.size > 4000)
      throw new InvalidInputError(
        "schema exceeds the 4000-field investigation budget; narrow the table",
      );
  }
}

function parentId(row: Row): string {
  if (row["super_class"] === undefined)
    throw new InvalidInputError("table parent field is not visible to this credential");
  const parent = row["super_class"] ?? "";
  if (parent !== "" && !/^[a-f0-9]{32}$/.test(parent))
    throw new InvalidInputError("table parent is not visible as a raw reference");
  return parent;
}

async function resolveField(
  reader: InstanceReader,
  schema: LiveSchema,
  name: string,
  cache: Map<string, LiveSchema>,
  signal: AbortSignal,
): Promise<LiveField> {
  const parts = name.split(".");
  if (parts.length > 3) throw new InvalidInputError("dot-walking is limited to two references");
  let current = schema;
  for (const [index, part] of parts.entries()) {
    const field = current.fields.find((candidate) => candidate.name === part);
    if (field === undefined) throw new InvalidInputError(`unknown or unreadable field: ${name}`);
    if (index === parts.length - 1) return field;
    if (field.reference === "") throw new InvalidInputError(`field is not a reference: ${part}`);
    current =
      cache.get(field.reference) ??
      (await readLiveSchema(reader, TableName.parse(field.reference), signal));
    cache.set(field.reference, current);
  }
  throw new InvalidInputError("field path is empty");
}

export async function resolveLiveFields(
  reader: InstanceReader,
  schema: LiveSchema,
  names: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, LiveField>> {
  const cache = new Map([[schema.table, schema]]);
  const result = new Map<string, LiveField>();
  for (const name of new Set(names))
    result.set(name, await resolveField(reader, schema, name, cache, signal));
  return result;
}
