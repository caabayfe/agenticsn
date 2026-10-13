// Spike S9: the sys_ids of the ACL operations used by the escalation table's ACLs.
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const query = encodeURIComponent("nameINread,write,create,delete");
console.log(
  JSON.stringify(
    await client.callApi(
      "GET",
      `/api/now/table/sys_security_operation?sysparm_query=${query}&sysparm_fields=sys_id,name&sysparm_no_count=true`,
      "ACL operations",
      signal,
    ),
  ),
);
