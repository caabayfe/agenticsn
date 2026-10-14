// Spike S14: every list layout of a table, with its view and columns (read-only).
import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2", table = "x_2222332_acc_rev_review_item"] =
  process.argv.slice(2);
const client = await connect(workspace, instance);
const rows = (t: string, query: string, fields: string[], limit = 50) =>
  client.query({ table: TableName.parse(t), query, fields, limit }, signal);
const out: Record<string, unknown> = {};
for (const list of await rows("sys_ui_list", `name=${table}`, [
  "sys_id",
  "view",
  "sys_domain",
  "sys_update_name",
  "sys_created_on",
  "parent",
  "relationship",
])) {
  const elements = await rows("sys_ui_list_element", `list_id=${list["sys_id"]}`, [
    "element",
    "position",
  ]);
  out[list["sys_id"] ?? ""] = {
    ...list,
    columns: elements
      .sort((a, b) => Number(a["position"]) - Number(b["position"]))
      .map((e) => e["element"]),
  };
}
out["views"] = await rows(
  "sys_ui_view",
  "sys_idIN13a5de2748af441f89dd7fb1ca038c09^ORname=Default view^ORtitle=Default view",
  ["sys_id", "name", "title"],
);
console.log(JSON.stringify(out, null, 2));
