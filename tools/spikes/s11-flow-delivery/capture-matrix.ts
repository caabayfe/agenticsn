// Spike S11: which preferences put a scoped Table API insert into a scoped update set?
//   A: apps.current_app + updateSetForScope<scope>   (what push sets)
//   B: A + sys_update_set
// Each variant inserts one property, reads where its update landed, and restores preferences.
//   bun capture-matrix.ts <workspace> <instance> <scope sys_id> <scoped update set sys_id> <A|B>
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", scopeId = "", setId = "", variant = "A"] =
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
const set = (await list("sys_update_set", `sys_id=${setId}`, "name,application"))[0];
console.log("target set:", JSON.stringify(set));
let property = "";
try {
  await prefer("apps.current_app", scopeId);
  await prefer(`updateSetForScope${scopeId}`, setId);
  if (variant === "B") await prefer("sys_update_set", setId);
  const row = (await client.sendJson(
    "POST",
    "/api/now/table/sys_properties?sysparm_fields=sys_id",
    {
      name: `x_2222332_s11.matrix_${variant.toLowerCase()}_${Date.now()}`,
      value: "1",
      type: "string",
      description: "Spike S11 capture matrix; safe to delete.",
    },
    "property",
    signal,
  )) as Row;
  property = row["sys_id"] ?? "";
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
const update = (await list("sys_update_xml", `name=sys_properties_${property}`, "update_set"))[0]?.[
  "update_set"
];
const landed = (await list("sys_update_set", `sys_id=${update}`, "name,application"))[0];
console.log(
  `variant ${variant}: update landed in`,
  JSON.stringify(landed),
  update === setId ? "(TARGET)" : "(NOT the target)",
);
