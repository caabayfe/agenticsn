// Spike S17: records the instance's answers to the SDK's transform of some records, through the
// product's runtime and connector, for the connector contract test. Not product code.
//   bun record.ts <workspace> <instance> <project dir> <out.json> <table> <sys_id> [...]
import { writeFileSync } from "node:fs";
import { loadFluentRuntime } from "../../../packages/cli/src/adapters/fluent/fluent-runtime-loader";
import { connect, signal } from "../s9-acl-delivery/connect";

const [workspace = "", instance = "", project = "", out = "", ...pairs] = process.argv.slice(2);
const records = [];
for (let i = 0; i + 1 < pairs.length; i += 2)
  records.push({ table: pairs[i] ?? "", sysId: pairs[i + 1] ?? "" });
const client = await connect(workspace, instance);
const exchanges: unknown[] = [];
const runtime = await loadFluentRuntime();
const host = "https://instance.example.com/";
const outcome = await runtime.transform(project, records, host, async (request) => {
  const answer = await client.exchange(
    { ...request, url: new URL(request.url).pathname + new URL(request.url).search },
    signal,
  );
  exchanges.push({
    request: { ...request, url: new URL(request.url).pathname + new URL(request.url).search },
    answer,
  });
  return answer;
});
writeFileSync(out, `${JSON.stringify({ records, exchanges }, null, 2)}\n`);
console.log(JSON.stringify(outcome), `${exchanges.length} exchanges`);
