// Spike S14: load an SDK-built list layout through fluent/load into the S14 probe update set
// (spike S11's route, ADR-0028), then read what the instance holds. Not product code: product
// requests go through the request scheduler (ADR-0016).
//   bun tools/spikes/s14-list-layouts/load.ts <workspace> <instance> <built app dir>
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

const [workspace = "", instance = "pdi2", appDir = ""] = process.argv.slice(2);
const APP = "24585a3c3484e481f8994b3c68c5d588";
const TABLE = "x_2222332_acc_rev_review_item";
const client = await connect(workspace, instance);
const rows = (table: string, query: string, fields: string[], limit = 50) =>
  client.query({ table: TableName.parse(table), query, fields, limit }, signal);

const user = (await rows("sys_user", "user_name=javascript:gs.getUserName()", ["sys_id"], 1))[0];
const prefs = () =>
  rows(
    "sys_user_preference",
    `user=${user?.["sys_id"] ?? ""}^nameINapps.current_app,sys_update_set,updateSetForScope${APP}`,
    ["name", "value"],
  );
const set =
  (
    await rows("sys_update_set", `name=S14 list layout probe^application=${APP}`, ["sys_id"], 1)
  )[0]?.["sys_id"] ?? "";
const lists = () =>
  rows("sys_ui_list", `name=${TABLE}^view.name=Default view^parentISEMPTY^relationshipISEMPTY`, [
    "sys_id",
    "sys_domain",
    "sys_update_name",
    "sys_updated_on",
  ]);

const report: Record<string, unknown> = {
  set,
  prefs_before: await prefs(),
  lists_before: await lists(),
};
const profile = await getInstance(workspace, InstanceName.parse(instance), new YamlProfileStore());
ensureDevelopmentInstance(profile);
const secret = await resolveSecret(
  profile,
  new LayeredCredentialStore(
    new EnvironmentCredentialStore(process.env),
    new KeychainCredentialStore(),
  ),
);
const form = new FormData();
for (const file of readdirSync(appDir).filter((f) => f.endsWith(".xml"))) {
  form.append(
    "files",
    new Blob([readFileSync(join(appDir, file))], { type: "application/xml" }),
    basename(file),
  );
}
const url = new URL(`/api/fluent/load/${APP}`, profile.url);
url.searchParams.set("targetUpdateSetId", set);
const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${profile.auth.method === "basic" ? profile.auth.username : ""}:${secret}`).toString("base64")}`,
    Accept: "application/json",
  },
  body: form,
});
report["load"] = `${response.status} ${(await response.text()).slice(0, 1500)}`;
report["lists_after"] = await lists();
for (const list of report["lists_after"] as Record<string, string>[]) {
  report[`elements_${list["sys_id"]}`] = (
    await rows("sys_ui_list_element", `list_id=${list["sys_id"]}`, ["element", "position"])
  )
    .sort((a, b) => Number(a["position"]) - Number(b["position"]))
    .map((e) => e["element"]);
}
report["captured"] = (
  await rows("sys_update_xml", `update_set=${set}`, ["name", "type", "action", "target_name"])
).map((r) => `${r["action"]} ${r["type"]} ${r["name"]} (${r["target_name"]})`);
report["prefs_after"] = await prefs();
console.log(JSON.stringify(report, null, 2));
