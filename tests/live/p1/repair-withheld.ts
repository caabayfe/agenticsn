import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeCapture } from "../../../packages/cli/src/adapters/fluent/capture-decoder";
import {
  capturedContentAgrees,
  compareUnit,
  computeUnitPlan,
  KeysetPager,
  TableName,
  unitDigest,
} from "../../../packages/core/src/index";
import { dependencies } from "./dependencies";

const [root = ""] = process.argv.slice(2);
if (!root) throw new Error("acceptance workspace required");
const saved = JSON.parse(readFileSync(join(root, "acceptance/missing-withheld.json"), "utf8"));
const { label, name, recordId } = saved;
const target = saved.result.batch.sysId;
if (
  label !== "p1-accept-pdi11-20261114-missing" ||
  name !== "p1-accept-pdi11-20261114.pending_missing" ||
  !/^[a-f0-9]{32}$/.test(recordId) ||
  !/^[a-f0-9]{32}$/.test(target)
)
  throw new Error("unexpected withheld test target");
const { deps, client } = await dependencies(root);
const query = { instance: "pdi11", label, allowCollisions: false };
const planned = await computeUnitPlan(deps, query);
const wanted = planned.loads
  .flatMap((load) => [...load.built.values()])
  .find(({ unit }) => unit.head.sysId === recordId)?.unit;
if (wanted?.head.table !== "sys_properties" || wanted.head.fields["name"] !== name)
  throw new Error("source does not identify the withheld test property");
const updates = [];
for await (const row of new KeysetPager(client).rows(
  {
    kind: "snapshot",
    table: TableName.parse("sys_update_xml"),
    base: `name=${wanted.updateName}`,
    fields: ["sys_id", "update_set", "payload"],
  },
  deps.signal,
))
  updates.push(row);
if (updates.length !== 1) throw new Error("expected exactly the deliberately withheld capture");
const capture = updates[0];
if (!capture) throw new Error("capture missing");
const quarantine = (
  await client.query(
    {
      table: TableName.parse("sys_update_set"),
      query: `sys_id=${capture["update_set"]}`,
      fields: ["name", "state", "application"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
const destination = (
  await client.query(
    {
      table: TableName.parse("sys_update_set"),
      query: `sys_id=${target}`,
      fields: ["name", "state", "application"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
if (
  quarantine?.["name"] !== `${label} withheld capture` ||
  quarantine["state"] !== "ignore" ||
  quarantine["application"] !== "global" ||
  destination?.["name"] !== `snagentic: ${label}` ||
  destination["state"] !== "in progress" ||
  destination["application"] !== "global"
)
  throw new Error("fault quarantine or original target changed");
const decoded = decodeCapture(wanted.updateName, capture["payload"] ?? "");
const live = (
  await client.query(
    {
      table: TableName.parse("sys_properties"),
      query: `sys_id=${recordId}`,
      fields: [...new Set(["sys_id", ...Object.keys(wanted.head.fields)])],
      limit: 1,
    },
    deps.signal,
  )
)[0];
if (
  !decoded ||
  !capturedContentAgrees(wanted, decoded.unit) ||
  !live ||
  compareUnit(wanted, { head: live, children: [], version: "", foreignRows: 0 }).length !== 0
)
  throw new Error("withheld capture or live content differs from reviewed source");
await client.writer.update(
  "sys_update_xml",
  capture["sys_id"] ?? "",
  { update_set: target },
  deps.signal,
);
const moved = (
  await client.query(
    {
      table: TableName.parse("sys_update_xml"),
      query: `sys_id=${capture["sys_id"]}`,
      fields: ["update_set"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
if (moved?.["update_set"] !== target) throw new Error("fault repair did not restore capture");
const binary = resolve(import.meta.dir, "../../../dist/snagentic");
const child = Bun.spawn(
  [
    binary,
    "plan-push",
    "--workspace",
    root,
    "--instance",
    "pdi11",
    "--label",
    label,
    "--format",
    "json",
  ],
  { stdout: "pipe", stderr: "pipe" },
);
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (code !== 0) throw new Error(`recovery plan failed: ${stderr || stdout}`);
const plan = JSON.parse(stdout);
if (plan.units.length !== 1 || plan.units[0].operation !== "record")
  throw new Error("restored evidence was not reconciled without a metadata reload");
writeFileSync(
  join(root, "acceptance/missing-repaired.json"),
  `${JSON.stringify({ capture: capture["sys_id"], from: capture["update_set"], target, build: unitDigest(wanted), plan }, null, 2)}\n`,
);
console.log(JSON.stringify({ faultRemoved: true, captureMatchedSourceAndLive: true, plan }));
