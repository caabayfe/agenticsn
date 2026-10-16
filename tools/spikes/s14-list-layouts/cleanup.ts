// Spike S14 cleanup (approved by the user): delete the stray list from the first load, with its
// columns, and mark the probe update set "ignore" so it is never promoted.
// snagentic's writer has no delete (by design), so this spike sends the Table API DELETE itself.
import { EnvironmentCredentialStore } from "../../../packages/cli/src/adapters/credentials/environment-credential-store";
import { KeychainCredentialStore } from "../../../packages/cli/src/adapters/credentials/keychain-credential-store";
import { LayeredCredentialStore } from "../../../packages/cli/src/adapters/credentials/layered-credential-store";
import { YamlProfileStore } from "../../../packages/cli/src/adapters/profiles/yaml-profile-store";
import {
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  resolveSecret,
  TableName,
} from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2"] = process.argv.slice(2);
const STRAY = "bb00a12109404cb7b11150408fb862bd";
const APP = "24585a3c3484e481f8994b3c68c5d588";
const client = await connect(workspace, instance);
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const username = profile.auth.method === "basic" ? profile.auth.username : "";
async function remove(table: string, sysId: string) {
  const response = await fetch(new URL(`/api/now/table/${table}/${sysId}`, profile.url), {
    method: "DELETE",
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}` },
  });
  if (response.status !== 204) {
    throw new Error(`deleting ${table} ${sysId}: HTTP ${response.status}`);
  }
}
const rows = (table: string, query: string, fields: string[]) =>
  client.query({ table: TableName.parse(table), query, fields, limit: 50 }, signal);

const list = await rows("sys_ui_list", `sys_id=${STRAY}`, ["sys_id", "view"]);
if (list[0]?.["view"] !== "13a5de2748af441f89dd7fb1ca038c09") {
  throw new Error("the stray list is not what the spike left; nothing deleted");
}
const columns = await rows("sys_ui_list_element", `list_id=${STRAY}`, ["sys_id"]);
for (const column of columns) {
  await remove("sys_ui_list_element", column["sys_id"] ?? "");
}
await remove("sys_ui_list", STRAY);
const set = await rows("sys_update_set", `name=S14 list layout probe^application=${APP}`, [
  "sys_id",
]);
await client.writer.update("sys_update_set", set[0]?.["sys_id"] ?? "", { state: "ignore" }, signal);
console.log(
  JSON.stringify({
    deleted_columns: columns.length,
    list_left: (await rows("sys_ui_list", `sys_id=${STRAY}`, ["sys_id"])).length,
    columns_left: (await rows("sys_ui_list_element", `list_id=${STRAY}`, ["sys_id"])).length,
    set_state: (await rows("sys_update_set", `sys_id=${set[0]?.["sys_id"] ?? ""}`, ["state"]))[0],
  }),
);
