// Spike S9: what the spike left on the instance.
import { connect, signal } from "./connect";

const [workspace = ".", instance = "pdi"] = process.argv.slice(2);
const client = await connect(workspace, instance);
const q = encodeURIComponent("nameSTARTSWITHsnagentic spike^ORdescriptionSTARTSWITHSpike S9");
console.log(
  JSON.stringify(
    await client.callApi(
      "GET",
      `/api/now/table/sys_remote_update_set?sysparm_query=${q}&sysparm_fields=sys_id,name,state,sys_created_on&sysparm_no_count=true`,
      "the spike's remote update sets",
      signal,
    ),
  ),
);
