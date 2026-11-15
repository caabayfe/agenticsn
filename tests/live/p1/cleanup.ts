// Explicitly invoked teardown of this acceptance run's five metadata records, through
// reviewed compiled-CLI deletion plans. Never removes customer records or update history.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { KeysetPager, SESSION_USER, TableName } from "../../../packages/core/src/index";
import { dependencies } from "./dependencies";

const [root = "", phase = ""] = process.argv.slice(2);
const tag = "p1-accept-pdi11-20261114";
if (!root.endsWith("/spaces/pdi11-p1-delivery-20261114")) throw new Error("unexpected workspace");
if (!["prepare", "flow", "subflow", "action", "properties", "verify"].includes(phase))
  throw new Error("cleanup phase required");
const cleanup = `${root}-cleanup`;
const output = join(root, "acceptance");
const label = `${tag}-cleanup`;
const binary = resolve(import.meta.dir, "../../../dist/snagentic");
const { deps, client } = await dependencies(root);
const drift = JSON.parse(readFileSync(join(output, "drift-withheld.json"), "utf8"));
const missing = JSON.parse(readFileSync(join(output, "missing-withheld.json"), "utf8"));
const records = [
  {
    phase: "flow",
    table: "sys_hub_flow",
    id: "4293bc5c863b41d9aad4dbb837087579",
    name: `${tag} flow`,
  },
  {
    phase: "subflow",
    table: "sys_hub_flow",
    id: "a406f5d9e04b46e999b508fb5dd670d5",
    name: `${tag} subflow verified`,
  },
  {
    phase: "action",
    table: "sys_hub_action_type_definition",
    id: "fb5d0c0eff624c42869015efa47055cd",
    name: `${tag} action`,
  },
  {
    phase: "properties",
    table: "sys_properties",
    id: String(missing.recordId),
    name: `${tag}.pending_missing`,
  },
  {
    phase: "properties",
    table: "sys_properties",
    id: String(drift.recordId),
    name: `${tag}.pending_drift`,
  },
];
if (records.some((record) => !/^[a-f0-9]{32}$/.test(record.id))) throw new Error("invalid test ID");

async function command(args: readonly string[]) {
  const child = Bun.spawn([...args], { cwd: cleanup, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr || stdout}`);
  return stdout;
}
const cli = (...args: string[]) =>
  command([binary, ...args, "--workspace", cleanup, "--format", "json"]);
const save = (file: string, value: unknown) =>
  writeFileSync(join(output, file), `${JSON.stringify(value, null, 2)}\n`);
async function read(table: string, id: string, fields: readonly string[]) {
  return (
    await client.query(
      { table: TableName.parse(table), query: `sys_id=${id}`, fields, limit: 1 },
      AbortSignal.timeout(30000),
    )
  )[0];
}
async function ignoreBatch(id: string, name: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("invalid batch ID");
  const set = await read("sys_update_set", id, ["name", "state", "application"]);
  if (
    set?.["name"] !== name ||
    set["application"] !== "global" ||
    !["in progress", "ignore"].includes(set["state"] ?? "")
  )
    throw new Error("test batch identity changed");
  if (set["state"] !== "ignore")
    await client.writer.update(
      "sys_update_set",
      id,
      { state: "ignore" },
      AbortSignal.timeout(30000),
    );
  if ((await read("sys_update_set", id, ["state"]))?.["state"] !== "ignore")
    throw new Error("test batch not ignored");
}

if (phase === "prepare") {
  if (existsSync(cleanup)) throw new Error("cleanup already prepared; inspect before resuming");
  if (
    !JSON.parse(readFileSync(join(output, "drift-blocked.json"), "utf8")).blocked.output.problems
      .length
  )
    throw new Error("drift acceptance evidence missing");
  for (const record of records) {
    if ((await read(record.table, record.id, ["name"]))?.["name"] !== record.name)
      throw new Error(`refusing cleanup of a changed record: ${record.id}`);
  }
  cpSync(
    join(root, ".snagentic/pdi11/push-journal.json"),
    join(output, "drift-blocked-journal.json"),
  );
  mkdirSync(cleanup);
  await cli("init", cleanup);
  mkdirSync(join(cleanup, "instances/pdi11"), { recursive: true });
  cpSync(
    join(root, "instances/pdi11/instance.yaml"),
    join(cleanup, "instances/pdi11/instance.yaml"),
  );
  await ignoreBatch("e9c0017dc3a057109176f3cc05013150", `snagentic: ${tag}`);
  await ignoreBatch(String(missing.result.batch.sysId), `snagentic: ${tag}-missing`);
  await ignoreBatch(String(drift.result.batch.sysId), `snagentic: ${tag}-drift`);
  save("cleanup-prepared.json", { cleanup, records });
  console.log(JSON.stringify({ prepared: true, cleanup, records: records.length }));
} else if (phase === "verify") {
  for (const record of records) {
    if (await read(record.table, record.id, ["sys_id"]))
      throw new Error(`test record survived: ${record.id}`);
  }
  const before: readonly Record<string, string>[] = JSON.parse(
    readFileSync(join(output, "preferences-before.json"), "utf8"),
  );
  const user = (await read("sys_user", SESSION_USER, ["sys_id"]))?.["sys_id"];
  if (!user) throw new Error("session user missing");
  const preferences: Readonly<Record<string, string>>[] = [];
  for await (const row of new KeysetPager(client).rows(
    {
      kind: "snapshot",
      table: TableName.parse("sys_user_preference"),
      base: `user=${user}^nameINapps.current_app,sys_update_set`,
      fields: ["sys_id", "name", "value"],
    },
    deps.signal,
  ))
    preferences.push(row);
  if (
    !before.every(
      (row) => preferences.find((held) => held["name"] === row["name"])?.["value"] === row["value"],
    )
  )
    throw new Error("preferences not restored");
  const propertyResult = JSON.parse(readFileSync(join(output, "cleanup-properties.json"), "utf8"));
  await ignoreBatch(String(propertyResult.push.batch.sysId), `snagentic: ${label}`);
  const originalSet = before.find((row) => row["name"] === "sys_update_set")?.["value"];
  const customerCaptures = [];
  if (originalSet) {
    for await (const row of new KeysetPager(client).rows(
      {
        kind: "snapshot",
        table: TableName.parse("sys_update_xml"),
        base: `update_set=${originalSet}^nameIN${records.map((record) => `${record.table}_${record.id}`).join(",")}`,
        fields: ["sys_id", "name"],
      },
      deps.signal,
    ))
      customerCaptures.push(row);
  }
  if (customerCaptures.length !== 0)
    throw new Error("test capture leaked into the original update set");
  save("cleanup-verified.json", {
    recordsRemoved: records.length,
    preferencesRestored: true,
    originalUpdateSetUntouched: true,
    testBatchesIgnored: true,
  });
  console.log(readFileSync(join(output, "cleanup-verified.json"), "utf8"));
} else {
  const selected = records.filter((record) => record.phase === phase);
  for (const record of selected) {
    if ((await read(record.table, record.id, ["name"]))?.["name"] !== record.name)
      throw new Error(`refusing deletion of a changed record: ${record.id}`);
  }
  writeFileSync(
    join(cleanup, "source/global/src/fluent/cleanup.now.ts"),
    selected.map((record) => `Now.del('${record.table}', { sys_id: '${record.id}' })`).join("\n"),
  );
  await cli("fluent-keys", "source/global");
  await command(["git", "add", "--", "source/global", "instances/pdi11"]);
  await command([
    "git",
    "-c",
    "user.name=snagentic acceptance",
    "-c",
    "user.email=acceptance@localhost",
    "commit",
    "-qm",
    `P1 acceptance cleanup: ${phase}`,
  ]);
  const plan = JSON.parse(await cli("plan-push", "--instance", "pdi11", "--label", label));
  save(`cleanup-${phase}-plan.json`, plan);
  if (
    !plan.ready ||
    !plan.gate.passed ||
    plan.collisions.length ||
    plan.units.length !== selected.length ||
    plan.units.some(
      (unit: { table: string; sysId: string; operation: string }) =>
        unit.operation !== "delete" ||
        !selected.some((record) => record.table === unit.table && record.id === unit.sysId),
    )
  )
    throw new Error(`unexpected cleanup plan: ${JSON.stringify(plan)}`);
  const push = JSON.parse(
    await cli("push", "--instance", "pdi11", "--label", label, "--plan", plan.planId, "--confirm"),
  );
  save(`cleanup-${phase}.json`, { plan, push });
  if (push.notApplied || push.notCaptured)
    throw new Error(`incomplete cleanup: ${JSON.stringify(push)}`);
  for (const record of selected) {
    if (await read(record.table, record.id, ["sys_id"]))
      throw new Error(`deletion not applied: ${record.id}`);
  }
  console.log(
    JSON.stringify({
      phase,
      deleted: selected.length,
      ledgerCommit: push.ledgerCommit,
      pendingCleared: !existsSync(join(cleanup, ".snagentic/pdi11/push-journal.json")),
    }),
  );
}
