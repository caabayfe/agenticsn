// Spike S12 (domain separation): how the Table API treats sys_domain on insert and update,
// written the way push writes (apps.current_app switched to the record's application).
// Not product code. Run from the repository root:
//   bun tools/spikes/s12-domains/probe.ts ~/dev/personal/agenticsn/spaces/pdi2 pdi2
// It leaves two inactive probe UI actions in the Access Review application, named
// "S12 domain probe ...", and moves the app's "Cancel campaign" UI action to global.

import { TableName } from "../../../packages/core/src/index";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "pdi2"] = process.argv.slice(2);
const APP = "24585a3c3484e481f8994b3c68c5d588";
const CAMPAIGN = "x_2222332_acc_rev_campaign";

const client = await connect(workspace, instance);
const first = async (table: string, query: string, fields: string[]) =>
  (await client.query({ table: TableName.parse(table), query, fields, limit: 1 }, signal))[0] ??
  null;

const user = await first("sys_user", "user_name=javascript:gs.getUserName()", [
  "sys_id",
  "sys_domain",
]);
const userId = user?.["sys_id"] ?? "";
const report: Record<string, unknown> = { user_domain: user?.["sys_domain"] };
for (const name of ["glide.sys.domain.default", "glide.sys.domain.use_record_domain"]) {
  const property = await first("sys_properties", `name=${name}`, ["value"]);
  report[name] = property?.["value"] ?? "(not set)";
}

const preference = await first("sys_user_preference", `user=${userId}^name=apps.current_app`, [
  "sys_id",
  "value",
]);
const previous = preference?.["value"] ?? "";
const prefId =
  preference?.["sys_id"] ??
  (
    await client.writer.insert(
      "sys_user_preference",
      { user: userId, name: "apps.current_app", value: APP },
      signal,
    )
  )["sys_id"] ??
  "";
await client.writer.update("sys_user_preference", prefId, { value: APP }, signal);
const domainOf = async (table: string, sysId: string) =>
  (await first(table, `sys_id=${sysId}`, ["sys_domain"]))?.["sys_domain"];
try {
  const probe = async (name: string, extra: Record<string, string>) =>
    (await first("sys_ui_action", `name=${name}`, ["sys_id"])) ??
    (await client.writer.insert(
      "sys_ui_action",
      { name, table: CAMPAIGN, active: "false", ...extra },
      signal,
    ));
  const plain = await probe("S12 domain probe: no domain (inactive)", {});
  report["insert_without_domain"] = await domainOf("sys_ui_action", plain["sys_id"] ?? "");
  const global = await probe("S12 domain probe: global (inactive)", { sys_domain: "global" });
  report["insert_with_global"] = await domainOf("sys_ui_action", global["sys_id"] ?? "");
  const cancel = await first("sys_ui_action", "sys_id=0a0ccbc0f70513822a0017c6fb2c0550", [
    "sys_id",
    "sys_domain",
  ]);
  report["update_before"] = cancel?.["sys_domain"];
  await client.writer.update(
    "sys_ui_action",
    cancel?.["sys_id"] ?? "",
    { sys_domain: "global" },
    signal,
  );
  report["update_after"] = await domainOf("sys_ui_action", cancel?.["sys_id"] ?? "");
  const capture = await first("sys_update_xml", `name=sys_ui_action_${global["sys_id"] ?? ""}`, [
    "update_set",
    "sys_domain",
    "payload",
  ]);
  const payload = capture?.["payload"] ?? "";
  report["capture_domain"] = capture?.["sys_domain"];
  report["payload_has_sys_domain"] = /<sys_domain>[^<]*<\/sys_domain>/.exec(payload)?.[0] ?? "no";
} finally {
  await client.writer.update("sys_user_preference", prefId, { value: previous }, signal);
  console.log(JSON.stringify(report, null, 2));
}
