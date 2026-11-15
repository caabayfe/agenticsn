import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { KeysetPager, SESSION_USER, TableName } from "../../../packages/core/src/index";
import { liveClient } from "../verify/live-connection";

const [workspace = "", evidence = ""] = process.argv.slice(2);
if (!workspace || !evidence) throw new Error("workspace and evidence directory required");
const client = await liveClient("pdi11", workspace);
const signal = AbortSignal.timeout(30000);
const users = await client.query(
  {
    table: TableName.parse("sys_user"),
    query: `sys_id=${SESSION_USER}`,
    fields: ["sys_id"],
    limit: 1,
  },
  signal,
);
const user = users[0]?.["sys_id"];
if (!user) throw new Error("signed-in user not found");
const rows = [];
const listing = {
  kind: "snapshot" as const,
  table: TableName.parse("sys_user_preference"),
  base: `user=${user}^nameINapps.current_app,sys_update_set`,
  fields: ["sys_id", "name", "value"],
};
for await (const row of new KeysetPager(client).rows(listing, signal)) rows.push(row);
writeFileSync(join(evidence, "preferences-before.json"), `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify({ preferencesRecorded: rows.length }));
