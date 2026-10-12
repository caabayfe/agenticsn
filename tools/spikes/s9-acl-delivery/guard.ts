// Spike S9: is the sys_update_xml insert refused for any payload, or only for an ACL's?
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const q = encodeURIComponent("name=snagentic spike S9: on-call escalation ACLs");
const sets = (await client.callApi(
  "GET",
  `/api/now/table/sys_remote_update_set?sysparm_query=${q}&sysparm_fields=sys_id,state&sysparm_no_count=true`,
  "the spike's remote update set",
  signal,
)) as { sys_id: string }[];
console.log("remote update sets:", JSON.stringify(sets));
const remote = sets[0]?.sys_id ?? "";
const id = "5e1a5e1a5e1a5e1a5e1a5e1a5e1a5e1a";
const payload = `<?xml version="1.0" encoding="UTF-8"?><record_update table="sys_properties"><sys_properties action="INSERT_OR_UPDATE"><name>u.spike_s9.harmless</name><type>string</type><value>x</value><sys_id>${id}</sys_id><sys_class_name>sys_properties</sys_class_name><sys_scope>global</sys_scope><sys_update_name>sys_properties_${id}</sys_update_name></sys_properties></record_update>`;
try {
  const row = await client.sendJson(
    "POST",
    "/api/now/table/sys_update_xml?sysparm_fields=sys_id",
    {
      remote_update_set: remote,
      name: `sys_properties_${id}`,
      type: "System Property",
      target_name: "u.spike_s9.harmless",
      action: "INSERT_OR_UPDATE",
      category: "customer",
      application: "global",
      payload,
    },
    "creating a harmless update record",
    signal,
  );
  console.log("harmless payload accepted:", JSON.stringify(row));
} catch (error) {
  console.log("harmless payload refused:", error instanceof Error ? error.message : String(error));
}
