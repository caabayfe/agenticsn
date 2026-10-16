// Spike S14: a list layout update as the platform records it (read-only). Not product code.
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2", prefix = "sys_ui_list_incident"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const found = await client.query(
  {
    table: TableName.parse("sys_update_xml"),
    query: `nameSTARTSWITH${prefix}`,
    fields: [
      "name",
      "type",
      "target_name",
      "action",
      "update_set",
      "application",
      "payload",
      "sys_created_on",
    ],
    limit: 3,
  },
  new AbortController().signal,
);
void signal;
for (const row of found) {
  console.log(JSON.stringify({ ...row, payload: undefined }));
  console.log((row["payload"] ?? "").slice(0, 2500));
  console.log("----");
}
