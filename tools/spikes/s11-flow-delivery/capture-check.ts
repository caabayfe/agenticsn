// Spike S11 (read-only): was the flow captured in an update set, and does the designer's API
// load it?
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", flowId = "", scopeId = ""] = process.argv.slice(2);
const client = await connect(workspace, instance);
const updates = await client.callApi(
  "GET",
  `/api/now/table/sys_update_xml?sysparm_query=${encodeURIComponent(`nameLIKE${flowId}^ORapplication=${scopeId}`)}&sysparm_fields=name,type,update_set,sys_created_on&sysparm_display_value=true&sysparm_exclude_reference_link=true&sysparm_no_count=true`,
  "update records",
  signal,
);
console.log("update records:", JSON.stringify(updates, null, 2));
try {
  const flow = (await client.callApi(
    "GET",
    `/api/now/processflow/flow/${flowId}?sysparm_transaction_scope=${scopeId}`,
    "designer load",
    signal,
  )) as Record<string, unknown>;
  console.log(
    "designer API error:",
    JSON.stringify({ code: flow["errorCode"], message: flow["errorMessage"] }),
  );
  console.log("designer API head:", JSON.stringify(flow).slice(0, 600));
} catch (error) {
  console.log(
    "designer API refused:",
    error instanceof Error ? error.message.slice(0, 300) : String(error),
  );
}
