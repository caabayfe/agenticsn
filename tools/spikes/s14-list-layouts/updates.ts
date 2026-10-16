// Spike S14: every update recorded under a name, in any update set (read-only).
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2", name = ""] = process.argv.slice(2);
const client = await connect(workspace, instance);
const rows = await client.query(
  {
    table: TableName.parse("sys_update_xml"),
    query: `name=${name}`,
    fields: ["update_set", "update_set.name", "type", "action", "sys_created_on", "sys_created_by"],
    limit: 20,
  },
  signal,
);
console.log(JSON.stringify(rows, null, 2));
