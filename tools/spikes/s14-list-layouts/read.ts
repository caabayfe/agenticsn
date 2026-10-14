// Spike S14 (list layout capture), read-only part: what the instance recorded for the Access
// Review application's list layouts and related lists. Not product code. Run from the root:
//   bun tools/spikes/s14-list-layouts/read.ts ~/dev/personal/agenticsn/spaces/pdi2 pdi2

import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const rows = (table: string, query: string, fields: string[], limit = 20) =>
  client.query({ table: TableName.parse(table), query, fields, limit }, signal);

const report: Record<string, unknown> = {};
for (const prefix of ["sys_ui_list_x_2222332_acc_rev", "sys_ui_related_x_2222332_acc_rev"]) {
  report[prefix] = await rows("sys_update_xml", `nameSTARTSWITH${prefix}`, [
    "name",
    "type",
    "action",
    "update_set",
    "sys_created_on",
  ]);
}
report["domain_09ff"] = await rows("domain", "sys_id=09ff3d105f231000b12e3572f2b4775d", ["name"]);
console.log(JSON.stringify(report, null, 2));
