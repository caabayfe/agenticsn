// Spike S11: move a record's update into an update set (push's moveUpdate), then read back.
//   bun move.ts <workspace> <instance> <update name> <update set sys_id>
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", name = "", setId = ""] = process.argv.slice(2);
const client = await connect(workspace, instance);
const q = (query: string) =>
  `/api/now/table/sys_update_xml?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=sys_id,name,update_set,type&sysparm_exclude_reference_link=true&sysparm_no_count=true`;
const rows = (await client.callApi("GET", q(`name=${name}`), "update", signal)) as Record<
  string,
  string
>[];
console.log("before:", JSON.stringify(rows));
for (const row of rows) {
  await client.sendJson(
    "PATCH",
    `/api/now/table/sys_update_xml/${row["sys_id"]}?sysparm_fields=sys_id`,
    { update_set: setId },
    "move",
    signal,
  );
}
console.log(
  "after:",
  JSON.stringify(await client.callApi("GET", q(`name=${name}`), "update", signal)),
);
console.log(
  "set now holds:",
  JSON.stringify(await client.callApi("GET", q(`update_set=${setId}`), "set", signal)),
);
