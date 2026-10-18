// Spike helper (spec 011): one Table API call on a development instance.
//   bun call.ts <workspace> <instance> <METHOD> <path> [json body]
import { instance } from "../s-a-b-pack-install/instance";

const [workspace = ".", name = "pdi2", method = "GET", path = "", body] = process.argv.slice(2);
const call = await instance(workspace, name);
const answer = await call(method, path, body === undefined ? undefined : JSON.parse(body));
console.log(answer.status, JSON.stringify(answer.json, null, 1));
