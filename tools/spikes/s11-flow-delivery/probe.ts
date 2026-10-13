// Spike S11 (delivering flows), step 1, read-only: what a flow's update record holds, and which
// flow APIs answer on this instance. Not product code.
//   bun tools/spikes/s11-flow-delivery/probe.ts <workspace> <instance>
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = ".", instance = "pdi2"] = process.argv.slice(2);
const client = await connect(workspace, instance);

const fields = "sys_id,name,type,target_name,action,update_set,sys_created_on,payload";
const query = encodeURIComponent(
  `${process.argv[4] ?? "nameSTARTSWITHsys_hub_flow_"}^ORDERBYDESCsys_created_on`,
);
const rows = (await client.callApi(
  "GET",
  `/api/now/table/sys_update_xml?sysparm_query=${query}&sysparm_fields=${fields}&sysparm_limit=1&sysparm_no_count=true&sysparm_exclude_reference_link=true`,
  "a flow's update record",
  signal,
)) as { payload: string; [k: string]: string }[];
const row = rows[0];
if (row === undefined) {
  console.log("no flow update record found");
} else {
  const { payload, ...rest } = row;
  console.log(JSON.stringify(rest, null, 2));
  console.log("payload length:", payload.length);
  const tags = new Map<string, number>();
  for (const m of payload.matchAll(
    /<(sys_hub_[a-z0-9_]+|sys_variable_value|sys_element_mapping)[\s>]/g,
  )) {
    tags.set(m[1] ?? "", (tags.get(m[1] ?? "") ?? 0) + 1);
  }
  console.log("element counts:", JSON.stringify(Object.fromEntries(tags), null, 2));
  console.log("payload head:", payload.slice(0, 1200));
}

for (const path of [
  "/api/now/processflow/flow/00000000000000000000000000000000",
  "/api/sn_flow_designer/flow/00000000000000000000000000000000",
  "/api/sn_cicd/update_set/preview/00000000000000000000000000000000",
]) {
  try {
    const answer = await client.callApi("GET", path, `probing ${path}`, signal);
    console.log(path, "answered:", JSON.stringify(answer).slice(0, 300));
  } catch (error) {
    console.log(
      path,
      "refused:",
      error instanceof Error ? error.message.slice(0, 300) : String(error),
    );
  }
}
