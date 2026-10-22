// Spike S-D (spec 011): removes a record the spike created on a development instance.
//   bun remove.ts <workspace> <instance> <table> <sys_id>
import { instance } from "../s-a-b-pack-install/instance";

const [workspace = ".", name = "pdi2", table = "", sysId = ""] = process.argv.slice(2);
const call = await instance(workspace, name);
const answer = await call("DELETE", `/api/now/table/${table}/${sysId}`);
console.log(table, sysId, answer.status);
