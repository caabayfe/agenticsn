import { attributes, element } from "./layout-xml";

// One record as an update, for a class the platform does not record when the Table API writes
// it (update_synch=false, such as a scheduled job): loaded through fluent/load, the update set
// records it (ADR-0030). The form is the one the ServiceNow SDK's Record() builds (record-plugin,
// SDK 4.13.6); a contract test in the cli package compares the two. Pure.

export interface RecordUpdate {
  readonly table: string;
  readonly sysId: string;
  // Content fields to write, the domain included; never a field pull withholds (a secret).
  readonly fields: Readonly<Record<string, string>>;
}

export const recordUpdateName = (record: { readonly table: string; readonly sysId: string }) =>
  `${record.table}_${record.sysId}`;

export function recordUpdateXml(
  record: RecordUpdate,
  scope: { readonly name: string; readonly sysId: string },
): string {
  const fields = Object.entries(record.fields)
    .filter(([name]) => !["sys_id", "sys_scope", "sys_update_name"].includes(name))
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const action = attributes([
    ["action", "INSERT_OR_UPDATE"],
    ["apply_defaults", "true"],
  ]);
  return [
    '<?xml version="1.0"?>',
    `<record_update${attributes([["table", record.table]])}>`,
    `  <${record.table}${action}>`,
    element("    ", "sys_id", record.sysId),
    element("    ", "sys_scope", scope.sysId, attributes([["display_value", scope.name]])),
    element("    ", "sys_update_name", recordUpdateName(record)),
    ...fields.map(([name, value]) => element("    ", name, value)),
    `  </${record.table}>`,
    "</record_update>",
  ].join("\n");
}
