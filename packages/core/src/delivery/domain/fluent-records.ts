// The records a Fluent build installs, read from its update XML (ADR-0028 as amended). Pure:
// the files come from the build, through the FluentPackages port.

export type FluentRecordKind = "flow" | "subflow" | "action" | "record";

export interface FluentRecord {
  readonly table: string;
  readonly sysId: string;
  // The update record's name in sys_update_xml.
  readonly updateName: string;
  readonly name: string;
  readonly kind: FluentRecordKind;
  readonly action: "INSERT_OR_UPDATE" | "DELETE";
}

const TAG = (name: string, xml: string) =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml)?.[1] ?? "";

function kindOf(table: string, xml: string): FluentRecordKind {
  if (table === "sys_hub_action_type_definition") return "action";
  if (table !== "sys_hub_flow") return "record";
  return TAG("type", xml) === "subflow" ? "subflow" : "flow";
}

// One built update file, or null when it is not a record update.
export function fluentRecordOf(xml: string): FluentRecord | null {
  const table = /<record_update[^>]*\stable="([^"]+)"/.exec(xml)?.[1];
  if (table === undefined) return null;
  const action = new RegExp(`<${table}\\s[^>]*action="([A-Z_]+)"`).exec(xml)?.[1];
  return {
    table,
    sysId: TAG("sys_id", xml),
    updateName: TAG("sys_update_name", xml),
    name: TAG("name", xml),
    kind: kindOf(table, xml),
    action: action === "DELETE" ? "DELETE" : "INSERT_OR_UPDATE",
  };
}

// What activate_flows publishes: flows and subflows together, actions apart. The server
// publishes actions, then subflows, then the flows that use them (test B10).
export function toPublish(records: readonly FluentRecord[]): {
  readonly flows: readonly string[];
  readonly actions: readonly string[];
} {
  const live = records.filter((r) => r.action !== "DELETE");
  return {
    flows: live.filter((r) => r.kind === "flow" || r.kind === "subflow").map((r) => r.sysId),
    actions: live.filter((r) => r.kind === "action").map((r) => r.sysId),
  };
}

// A captured update of a flow or action holds its published version: the flow's status is
// published and the compiled snapshot travels with it; an action carries its snapshot (test B5).
export function holdsPublished(record: FluentRecord, payload: string): boolean {
  if (record.kind === "flow" || record.kind === "subflow") {
    const flow = /<sys_hub_flow\s[^>]*>[\s\S]*?<status>([^<]*)<\/status>/.exec(payload);
    return flow?.[1] === "published" && payload.includes("<sys_hub_flow_snapshot");
  }
  return record.kind !== "action" || payload.includes("<sys_hub_action_type_snapshot");
}
