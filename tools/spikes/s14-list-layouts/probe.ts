// Spike S14 (list layout capture): what a Table API write to a list layout records, written the
// way push writes (the application current, a probe update set current). Not product code.
//   bun tools/spikes/s14-list-layouts/probe.ts ~/dev/personal/agenticsn/spaces/pdi2 pdi2
// It leaves an update set "S14 list layout probe" in the Access Review application. Every
// field it changes is put back.

import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2", experiment = "all"] = process.argv.slice(2);
const APP = "24585a3c3484e481f8994b3c68c5d588";
const LIST = "d32933baa1e6a682d85483e8f65ccbc2"; // x_2222332_acc_rev_review_item, Default view
const ELEMENT = "29d1c31bd74b804106387c4dab36ebeb"; // its "campaign" column, position 7

const client = await connect(workspace, instance);
const rows = (table: string, query: string, fields: string[], limit = 50) =>
  client.query({ table: TableName.parse(table), query, fields, limit }, signal);
const first = async (table: string, query: string, fields: string[]) =>
  (await rows(table, query, fields, 1))[0] ?? null;

const user = await first("sys_user", "user_name=javascript:gs.getUserName()", ["sys_id"]);
const userId = user?.["sys_id"] ?? "";
const saved = new Map<string, string | null>();
async function prefer(name: string, value: string) {
  const row = await first("sys_user_preference", `user=${userId}^name=${name}`, [
    "sys_id",
    "value",
  ]);
  if (!saved.has(name)) {
    saved.set(name, row?.["value"] ?? null);
  }
  if (row === null) {
    await client.writer.insert("sys_user_preference", { user: userId, name, value }, signal);
  } else {
    await client.writer.update("sys_user_preference", row["sys_id"] ?? "", { value }, signal);
  }
}

const report: Record<string, unknown> = {};
const captured = async (set: string) =>
  (await rows("sys_update_xml", `update_set=${set}`, ["name", "type", "action"])).map(
    (r) => `${r["action"]} ${r["type"]} ${r["name"]}`,
  );
try {
  await prefer("apps.current_app", APP);
  const existing = await first(
    "sys_update_set",
    `name=S14 list layout probe^application=${APP}^state=in progress`,
    ["sys_id"],
  );
  const set =
    existing?.["sys_id"] ??
    (
      await client.writer.insert(
        "sys_update_set",
        { name: "S14 list layout probe", application: APP, state: "in progress" },
        signal,
      )
    )["sys_id"] ??
    "";
  report["set_application"] = (await first("sys_update_set", `sys_id=${set}`, ["application"]))?.[
    "application"
  ];
  await prefer(`updateSetForScope${APP}`, set);
  await prefer("sys_update_set", set);
  report["before"] = await captured(set);
  if (experiment === "all" || experiment === "element") {
    await client.writer.update("sys_ui_list_element", ELEMENT, { position: "8" }, signal);
    await client.writer.update("sys_ui_list_element", ELEMENT, { position: "7" }, signal);
    report["after_element"] = await captured(set);
  }
  if (experiment === "all" || experiment === "list") {
    const list = await first("sys_ui_list", `sys_id=${LIST}`, ["sys_name"]);
    const name = list?.["sys_name"] ?? "";
    await client.writer.update("sys_ui_list", LIST, { sys_name: `${name} (S14)` }, signal);
    await client.writer.update("sys_ui_list", LIST, { sys_name: name }, signal);
    report["after_list"] = await captured(set);
  }
  if (experiment === "all" || experiment === "control") {
    // A record class the platform records normally: one of spike S12's inactive UI actions.
    const action = await first("sys_ui_action", "nameSTARTSWITHS12 domain probe: global", [
      "sys_id",
      "hint",
    ]);
    const id = action?.["sys_id"] ?? "";
    await client.writer.update("sys_ui_action", id, { hint: "S14 control" }, signal);
    await client.writer.update("sys_ui_action", id, { hint: action?.["hint"] ?? "" }, signal);
    report["after_control"] = await captured(set);
  }
  report["anywhere"] = await rows(
    "sys_update_xml",
    "nameSTARTSWITHsys_ui_list_x_2222332_acc_rev_review_item",
    ["name", "type", "update_set"],
  );
} finally {
  for (const [name, value] of saved) {
    const row = await first("sys_user_preference", `user=${userId}^name=${name}`, ["sys_id"]);
    if (row !== null && value !== null) {
      await client.writer.update("sys_user_preference", row["sys_id"] ?? "", { value }, signal);
    }
  }
  report["restored"] = Object.fromEntries(saved);
  console.log(JSON.stringify(report, null, 2));
}
