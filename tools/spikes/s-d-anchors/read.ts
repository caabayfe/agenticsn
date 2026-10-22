// Spike S-D (spec 011): reads what an import set load did. Read only.
//   bun read.ts <workspace> <instance> <table> <encoded query> <fields>
import { instance } from "../s-a-b-pack-install/instance";

const [workspace = ".", name = "pdi2", table = "", query = "", fields = "sys_id"] =
  process.argv.slice(2);
const call = await instance(workspace, name);
const answer = await call(
  "GET",
  `/api/now/table/${table}?sysparm_query=${encodeURIComponent(query)}&sysparm_fields=${fields}&sysparm_limit=50&sysparm_no_count=true&sysparm_exclude_reference_link=true`,
);
console.log(answer.status, JSON.stringify(answer.json, null, 1));
