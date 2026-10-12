// Spike S9, step 1 (read-only): what an ACL's update record looks like, and whether the CI/CD
// update set API exists on this instance.
//   bun tools/spikes/s9-acl-delivery/probe.ts <workspace> <instance>
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi"] = process.argv.slice(2);
const client = await connect(workspace, instance);

const fields = "sys_id,name,type,target_name,action,category,update_set,remote_update_set,payload";
const query = encodeURIComponent("nameSTARTSWITHsys_security_acl_^ORDERBYDESCsys_created_on");
const rows = await client.callApi(
  "GET",
  `/api/now/table/sys_update_xml?sysparm_query=${query}&sysparm_fields=${fields}&sysparm_limit=1&sysparm_no_count=true&sysparm_exclude_reference_link=true`,
  "an ACL update record",
  signal,
);
console.log(JSON.stringify(rows, null, 2));

// A preview of a remote update set that does not exist: 404 or a "not found" message means the
// endpoint exists; anything about an unknown path means it does not.
try {
  const answer = await client.callApi(
    "POST",
    "/api/sn_cicd/update_set/preview/00000000000000000000000000000000",
    "previewing a missing remote update set",
    signal,
  );
  console.log("preview answered:", JSON.stringify(answer));
} catch (error) {
  console.log("preview refused:", error instanceof Error ? error.message : String(error));
}
