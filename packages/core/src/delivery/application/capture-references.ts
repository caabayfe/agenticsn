import type { BuiltUnit } from "../../authoring/domain/unit";
import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { KeysetPager } from "../../sync/application/keyset-pager";

const REFERENCES: Readonly<
  Record<string, { readonly field: string; readonly table: string; readonly parent: string }>
> = {
  sys_hub_action_instance_v2: {
    field: "action_type",
    table: "sys_hub_action_type_snapshot",
    parent: "parent_action",
  },
  sys_hub_sub_flow_instance_v2: {
    field: "subflow",
    table: "sys_hub_flow_snapshot",
    parent: "parent_flow",
  },
};

// Publishing replaces definition references with snapshot IDs. Resolve their parents through
// indexed reads; matching a name or an unverified parent caption cannot establish identity.
function referenceGroups(built: BuiltUnit, actual: BuiltUnit) {
  const groups = new Map<string, { parent: string; ids: Set<string> }>();
  for (const wanted of built.children) {
    const spec = REFERENCES[wanted.table];
    if (spec === undefined || wanted.sysId === "") continue;
    const held = actual.children.find(
      (row) => row.table === wanted.table && row.sysId === wanted.sysId,
    )?.fields[spec.field];
    if (held === undefined || held === wanted.fields[spec.field] || !/^[a-f0-9]{32}$/.test(held))
      continue;
    const group = groups.get(spec.table) ?? { parent: spec.parent, ids: new Set<string>() };
    group.ids.add(held);
    groups.set(spec.table, group);
  }
  return groups;
}

export async function captureReferences(
  reader: InstanceReader,
  built: BuiltUnit,
  actual: BuiltUnit,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const references = new Map<string, string>();
  const pager = new KeysetPager(reader);
  for (const [table, group] of referenceGroups(built, actual)) {
    const ids = [...group.ids];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const listing = {
        kind: "snapshot" as const,
        table: TableName.parse(table),
        base: `sys_idIN${ids.slice(offset, offset + 100).join(",")}`,
        fields: ["sys_id", group.parent],
      };
      for await (const row of pager.rows(listing, signal)) {
        const parent = row[group.parent];
        if (parent) references.set(row["sys_id"] ?? "", parent);
      }
    }
  }
  return references;
}
