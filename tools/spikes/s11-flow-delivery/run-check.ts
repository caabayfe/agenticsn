// Spike S11, criterion 1: create a test incident that matches the flow's trigger, then read the
// flow's run (sys_flow_context) and the incident's work notes.
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", flowId = ""] = process.argv.slice(2);
const client = await connect(workspace, instance);
const incident = (await client.sendJson(
  "POST",
  "/api/now/table/incident?sysparm_fields=sys_id,number",
  {
    short_description: "S11 spike: flow delivery test",
    description: "Created by snagentic spike S11; safe to delete.",
  },
  "test incident",
  signal,
)) as { sys_id: string; number: string };
console.log("incident:", JSON.stringify(incident));
for (let attempt = 1; attempt <= 12; attempt += 1) {
  await Bun.sleep(5000);
  const notes = (await client.callApi(
    "GET",
    `/api/now/table/sys_journal_field?sysparm_query=${encodeURIComponent(`element_id=${incident.sys_id}^element=work_notes`)}&sysparm_fields=value,sys_created_by&sysparm_no_count=true`,
    "work notes",
    signal,
  )) as { value: string }[];
  const runs = (await client.callApi(
    "GET",
    `/api/now/table/sys_flow_context?sysparm_query=${encodeURIComponent(`flow=${flowId}^source_record=${incident.sys_id}`)}&sysparm_fields=state,sys_created_on&sysparm_no_count=true`,
    "flow runs",
    signal,
  )) as { state: string }[];
  console.log(`after ${attempt * 5}s: runs ${JSON.stringify(runs)} notes ${JSON.stringify(notes)}`);
  if (notes.length > 0 && runs.some((r) => r.state === "COMPLETE")) break;
}
