// Spike S11 control: with the same preferences as capture.ts, does a plain Table API update of
// the flow record land in the scoped scratch set? Preferences are restored afterwards.
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", scopeId = "", flowId = "", setId = ""] =
  process.argv.slice(2);
const client = await connect(workspace, instance);
type Row = Record<string, string>;
const list = async (table: string, query: string, fields: string) =>
  (await client.callApi(
    "GET",
    `/api/now/table/${table}?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=${fields}&sysparm_exclude_reference_link=true&sysparm_no_count=true`,
    table,
    signal,
  )) as Row[];
const admin = (await list("sys_user", "user_name=admin", "sys_id"))[0]?.sys_id ?? "";
const switched: { sysId: string; previous: string; created: boolean; name: string }[] = [];
const prefer = async (name: string, value: string) => {
  const existing = (
    await list("sys_user_preference", `user=${admin}^name=${name}`, "sys_id,value")
  )[0];
  if (existing) {
    await client.sendJson(
      "PATCH",
      `/api/now/table/sys_user_preference/${existing["sys_id"]}?sysparm_fields=sys_id`,
      { value },
      name,
      signal,
    );
    switched.push({
      sysId: existing["sys_id"] ?? "",
      previous: existing["value"] ?? "",
      created: false,
      name,
    });
  } else {
    const row = (await client.sendJson(
      "POST",
      "/api/now/table/sys_user_preference?sysparm_fields=sys_id",
      { user: admin, name, value },
      name,
      signal,
    )) as Row;
    switched.push({ sysId: row["sys_id"] ?? "", previous: "", created: true, name });
  }
};
try {
  await prefer("apps.current_app", scopeId);
  await prefer(`updateSetForScope${scopeId}`, setId);
  const created = (await client.sendJson(
    "POST",
    "/api/now/table/sys_properties?sysparm_fields=sys_id,sys_scope",
    {
      name: "x_2222332_s11.control",
      value: "1",
      type: "string",
      description: "Spike S11 control; safe to delete.",
    },
    "control property",
    signal,
  )) as Row;
  console.log("new property:", JSON.stringify(created));
  if (process.env["S11_EDIT_FLOW"] === "1")
    await client.sendJson(
      "PATCH",
      `/api/now/table/sys_hub_flow/${flowId}?sysparm_fields=sys_id`,
      {
        description:
          "Spike S11: adds a work note to incidents whose short description starts with S11 (control edit)",
      },
      "control edit",
      signal,
    );
} finally {
  for (const s of switched.reverse()) {
    await (s.created
      ? client.callApi("DELETE", `/api/now/table/sys_user_preference/${s.sysId}`, s.name, signal)
      : client.sendJson(
          "PATCH",
          `/api/now/table/sys_user_preference/${s.sysId}?sysparm_fields=sys_id`,
          { value: s.previous },
          s.name,
          signal,
        )
    ).catch((e) => console.log("restore failed", s.name, String(e)));
  }
}
console.log(
  "records in set:",
  JSON.stringify(await list("sys_update_xml", `update_set=${setId}`, "name,type,sys_updated_on")),
);
console.log(
  "flow:",
  JSON.stringify((await list("sys_hub_flow", `sys_id=${flowId}`, "status,active"))[0]),
);
