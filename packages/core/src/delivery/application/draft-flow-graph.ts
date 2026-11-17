import type { BuiltUnit, Fields, InstanceCopy, UnitRecord } from "../../authoring/index";
import type { InstanceReader } from "../../connection/index";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/index";

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
};
const NESTED = new Set([
  "sys_hub_alias_mapping",
  "sys_variable_value",
  "sys_element_mapping",
  "sys_hub_pill_compound",
  "sys_flow_cat_variable",
  "sys_translated_text",
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

function queryFor(table: string, rows: readonly UnitRecord[], captured: BuiltUnit): string | null {
  if (table === "sys_documentation" || table === "sys_choice") {
    const names = [...new Set(rows.map((row) => row.fields["name"]).filter(Boolean))];
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
    return `nameIN${names.join(",")}`;
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
  return `${owner}IN${[...new Set(ids)].join(",")}`;
}

async function children(
  reader: InstanceReader,
  built: BuiltUnit,
  captured: BuiltUnit,
  signal: AbortSignal,
): Promise<UnitRecord[] | null> {
  const groups = Map.groupBy([...built.children, ...captured.children], (row) => row.table);
  for (const table of RUNTIME) if (!groups.has(table)) groups.set(table, []);
  const live: UnitRecord[] = [];
  const pager = new KeysetPager(reader);
  for (const [table, rows] of groups) {
    const base = queryFor(table, rows, captured);
    if (base === null) return null;
    const fields = [
      ...new Set(["sys_id", "sys_domain", ...rows.flatMap((row) => Object.keys(row.fields))]),
    ];
    for await (const row of pager.rows(
      { kind: "snapshot", table: TableName.parse(table), base, fields, allDomains: true },
      signal,
    )) {
      const id = row["sys_id"] ?? "";
      if (!ID.test(id) || (row["sys_domain"] ?? "global") !== "global" || live.length >= 1000)
        return null;
      live.push({ table, sysId: id, action: "INSERT_OR_UPDATE", fields: row, referenceNames: {} });
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
): Promise<{ readonly unit: BuiltUnit; readonly rows: readonly Fields[] } | null> {
  const rows = await children(reader, built, captured, signal);
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
