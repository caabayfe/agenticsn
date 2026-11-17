import type { BuiltUnit, Fields, InstanceCopy, UnitRecord } from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { readLiveSchema } from "../../investigation/index";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/index";

export type DraftSchemaCache = Map<string, Promise<ReadonlySet<string>>>;

async function nativeFields(
  reader: InstanceReader,
  table: string,
  cache: DraftSchemaCache,
  signal: AbortSignal,
) {
  let fields = cache.get(table);
  if (fields === undefined) {
    fields = readLiveSchema(reader, TableName.parse(table), signal).then(
      (schema) => new Set(schema.fields.map((field) => field.name)),
    );
    cache.set(table, fields);
  }
  return fields;
}

// Only recorded draft-flow ownership shapes. Unknown tables fail closed; a capture alone
// cannot establish that the mutable live draft still has the reviewed authored graph.
const OWNERS: Readonly<Record<string, string>> = {
  sys_hub_trigger_instance_v2: "flow",
  sys_hub_action_instance_v2: "flow",
  sys_hub_sub_flow_instance_v2: "flow",
  sys_hub_flow_logic_instance_v2: "flow",
  sys_hub_trigger_instance: "flow",
  sys_hub_action_instance: "flow",
  sys_hub_sub_flow_instance: "flow",
  sys_hub_flow_stage: "flow",
  sys_hub_flow_input: "model",
  sys_hub_flow_output: "model",
  sys_hub_flow_variable: "model",
  sys_hub_alias_mapping: "source_id",
  sys_variable_value: "document_key",
  sys_element_mapping: "id",
  sys_hub_pill_compound: "attached_to",
  sys_flow_cat_variable_model: "id",
  sys_flow_cat_variable: "flow_catalog_model",
  sys_translated_text: "documentkey",
  sys_flow_trigger_plan: "plan_id",
  sys_flow_subflow_plan: "plan_id",
  sys_hub_action_input_action_instance: "action_input",
};
const NESTED = new Set([
  "sys_hub_alias_mapping",
  "sys_variable_value",
  "sys_element_mapping",
  "sys_hub_pill_compound",
  "sys_flow_cat_variable",
  "sys_translated_text",
  "sys_hub_action_input_action_instance",
]);
const ID = /^[a-f0-9]{32}$/;
const RUNTIME = [
  "sys_hub_trigger_instance_v2",
  "sys_hub_action_instance_v2",
  "sys_hub_sub_flow_instance_v2",
  "sys_hub_flow_logic_instance_v2",
  "sys_hub_flow_stage",
  "sys_hub_flow_input",
  "sys_hub_flow_output",
  "sys_hub_flow_variable",
  "sys_hub_alias_mapping",
];

function queryFor(
  table: string,
  rows: readonly UnitRecord[],
  captured: BuiltUnit,
): { readonly base: string; readonly key: string } | null {
  if (table === "sys_documentation" || table === "sys_choice") {
    const names = [...new Set(rows.map((row) => row.fields["name"]).filter(Boolean))];
    // Native captures include empty delete_multiple directives, not authored records.
    // Read the three owned variable namespaces instead of treating missing name fields
    // as an unknown graph or trusting the capture to prove that they are still empty.
    if (
      names.length === 0 &&
      rows.every((row) => row.sysId === "" && Object.keys(row.fields).length === 0)
    ) {
      names.push(
        ...["input", "output", "variable"].map(
          (kind) => `var__m_sys_hub_flow_${kind}_${captured.head.sysId}`,
        ),
      );
    }
    if (
      names.length === 0 ||
      names.some(
        (name) =>
          !new RegExp(`^var__m_sys_hub_flow_(input|output|variable)_${captured.head.sysId}$`).test(
            name ?? "",
          ),
      )
    )
      return null;
    return { base: `nameIN${names.join(",")}`, key: "name" };
  }
  const owner = OWNERS[table];
  if (owner === undefined) return null;
  const ids = NESTED.has(table)
    ? [
        captured.head.sysId,
        ...captured.children.map((row) => row.sysId).filter((id) => ID.test(id)),
      ]
    : [captured.head.sysId];
  if (ids.length > 100) return null;
  return { base: `${owner}IN${[...new Set(ids)].join(",")}`, key: owner };
}

function projectChild(table: string, row: Fields, columns: ReadonlySet<string>): UnitRecord | null {
  const fields = Object.fromEntries(Object.entries(row).filter(([field]) => columns.has(field)));
  const id = fields["sys_id"] ?? "";
  if (!ID.test(id) || (fields["sys_domain"] ?? "global") !== "global") return null;
  return { table, sysId: id, action: "INSERT_OR_UPDATE", fields, referenceNames: {} };
}

async function children(
  reader: InstanceReader,
  built: BuiltUnit,
  captured: BuiltUnit,
  schemas: DraftSchemaCache,
  signal: AbortSignal,
): Promise<UnitRecord[] | null> {
  const groups = Map.groupBy([...built.children, ...captured.children], (row) => row.table);
  for (const table of RUNTIME) if (!groups.has(table)) groups.set(table, []);
  const live: UnitRecord[] = [];
  const pager = new KeysetPager(reader);
  for (const [table, rows] of groups) {
    const query = queryFor(table, rows, captured);
    if (query === null) return null;
    const columns = await nativeFields(reader, table, schemas, signal);
    if (!columns.has(query.key)) return null;
    const fields = [
      ...new Set(["sys_id", "sys_domain", ...rows.flatMap((row) => Object.keys(row.fields))]),
    ].filter((field) => columns.has(field));
    for await (const row of pager.rows(
      {
        kind: "snapshot",
        table: TableName.parse(table),
        base: query.base,
        fields,
        allDomains: true,
      },
      signal,
    )) {
      const child = projectChild(table, row, columns);
      if (child === null || live.length >= 1000) return null;
      live.push(child);
    }
  }
  return live;
}

export async function readDraftFlowGraph(
  reader: InstanceReader,
  built: BuiltUnit,
  captured: BuiltUnit,
  copy: InstanceCopy,
  signal: AbortSignal,
  schemas: DraftSchemaCache = new Map(),
): Promise<{ readonly unit: BuiltUnit; readonly rows: readonly Fields[] } | null> {
  const rows = await children(reader, built, captured, schemas, signal);
  if (rows === null) return null;
  return {
    unit: {
      ...built,
      head: { ...built.head, fields: copy.head, referenceNames: {} },
      children: rows,
    },
    rows: rows.map((row) => row.fields),
  };
}
