// Spike S11: publish flows through the endpoint the ServiceNow SDK uses, optionally with the
// session user moved to the global domain for the call, and restored afterwards.
//   bun activate.ts <workspace> <instance> <scope sys_id> <flow sys_id,...> [--global-domain]
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2", scopeId = "", flowIds = "", mode = ""] =
  process.argv.slice(2);
const client = await connect(workspace, instance);
const users = (await client.callApi(
  "GET",
  "/api/now/table/sys_user?sysparm_query=user_name=admin&sysparm_fields=sys_id,sys_domain&sysparm_exclude_reference_link=true&sysparm_no_count=true",
  "admin",
  signal,
)) as { sys_id: string; sys_domain: string }[];
const admin = users[0];
if (admin === undefined) throw new Error("no admin");
const moveDomain = mode === "--global-domain" && admin.sys_domain !== "global";
if (moveDomain) {
  await client.sendJson(
    "PATCH",
    `/api/now/table/sys_user/${admin.sys_id}?sysparm_fields=sys_domain`,
    { sys_domain: "global" },
    "admin to global",
    signal,
  );
  console.log("admin moved from", admin.sys_domain, "to global");
}
try {
  // The endpoint takes { sys_id, active, state } objects (its request example), and answers 422
  // with a per-flow result when publishing fails, which the client reports as an error.
  const answer = await client.sendJson(
    "POST",
    `/api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=${scopeId}`,
    {
      flows: flowIds.split(",").map((sys_id) => ({ sys_id, active: "true", state: "" })),
      actions: [],
    },
    "activating flows",
    signal,
  );
  console.log("activation:", JSON.stringify(answer, null, 2));
} catch (error) {
  console.log("activation refused:", error instanceof Error ? error.message : String(error));
} finally {
  if (moveDomain) {
    await client.sendJson(
      "PATCH",
      `/api/now/table/sys_user/${admin.sys_id}?sysparm_fields=sys_domain`,
      { sys_domain: admin.sys_domain },
      "admin restored",
      signal,
    );
    console.log("admin restored to", admin.sys_domain);
  }
}
const flow = await client.callApi(
  "GET",
  `/api/now/table/sys_hub_flow/${flowIds.split(",")[0]}?sysparm_fields=status,active,master_snapshot,latest_snapshot,sys_domain&sysparm_exclude_reference_link=true`,
  "flow state",
  signal,
);
console.log("flow now:", JSON.stringify(flow));
