// Spike S-B: the Import Set API as accelerator load would use it. 20 locations through
// imp_location (transform map "Location", coalescing on name and address): singly, then the same
// rows again with insertMultiple, to see the per-row answers, timing and coalescing.
//   bun s-b.ts <workspace> <instance>
import { instance } from "./instance";

const [workspace = ".", name = "pdi2"] = process.argv.slice(2);
const call = await instance(workspace, name);
const rows = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(2, "0");
  return {
    name: `snagentic test S-B location ${n}`,
    street: `${n} Spike Street`,
    city: "Testville",
    state: "TS",
    zip: `00${n}`,
    country: "AU",
  };
});

const statuses = new Map<string, number>();
let ms = 0;
for (const row of rows) {
  const answer = await call("POST", "/api/now/import/imp_location", row);
  ms += answer.ms;
  const results = (answer.json as { result?: { status?: string }[] }).result ?? [];
  for (const r of results) statuses.set(r.status ?? "?", (statuses.get(r.status ?? "?") ?? 0) + 1);
  if (row === rows[0])
    console.log("single, first answer:", answer.status, JSON.stringify(answer.json).slice(0, 700));
}
console.log("single, 20 rows:", Object.fromEntries(statuses), `${ms} ms`);

const multi = await call("POST", "/api/now/import/imp_location/insertMultiple", { records: rows });
console.log(
  "insertMultiple, same 20 rows:",
  multi.status,
  `${multi.ms} ms`,
  JSON.stringify(multi.json).slice(0, 700),
);

const count = await call(
  "GET",
  "/api/now/stats/cmn_location?sysparm_query=nameSTARTSWITHsnagentic test S-B&sysparm_count=true",
);
console.log("cmn_location rows named snagentic test S-B:", JSON.stringify(count.json));
