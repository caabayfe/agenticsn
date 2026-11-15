import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeUnitPlan, pushUnits, TableName } from "../../../packages/core/src/index";
import { dependencies } from "./dependencies";

const [root = "", phase = ""] = process.argv.slice(2);
if (!root || !["missing", "drift"].includes(phase))
  throw new Error("workspace and missing|drift phase required");
const tag = "p1-accept-pdi11-20261114";
const label = `${tag}-${phase}`;
const binary = resolve(import.meta.dir, "../../../dist/snagentic");
const name = `${tag}.pending_${phase}`;
const definition = join(root, `source/global/src/fluent/pending-${phase}.now.ts`);
if (existsSync(definition)) throw new Error("phase already prepared: inspect it before retrying");

async function run(args: readonly string[]) {
  const child = Bun.spawn([...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${args[0]} failed (${code}): ${stderr || stdout}`);
  return stdout;
}

writeFileSync(
  definition,
  `import { Record } from '@servicenow/sdk/core'\nRecord({ $id: Now.ID['p1_pending_${phase}'], table: 'sys_properties', data: { name: '${name}', value: 'source value', type: 'string', description: 'P1 acceptance-only property' } })\n`,
);
await run([binary, "fluent-keys", "source/global", "--workspace", root, "--format", "json"]);
await run(["git", "add", "--", "source/global"]);
await run([
  "git",
  "-c",
  "user.name=snagentic acceptance",
  "-c",
  "user.email=acceptance@localhost",
  "commit",
  "-qm",
  `P1 ${phase} capture acceptance source`,
]);
const { deps, client } = await dependencies(root);
const query = { instance: "pdi11", label, allowCollisions: false };
const { plan } = await computeUnitPlan(deps, query);
if (
  !plan.ready ||
  plan.units.length !== 1 ||
  plan.units[0]?.table !== "sys_properties" ||
  plan.units[0]?.name !== name
)
  throw new Error(`unexpected fault plan: ${JSON.stringify(plan)}`);
const planned = plan.units[0];
let injected = false;
const installer = {
  publish: deps.installer.publish.bind(deps.installer),
  load: async (...args: Parameters<typeof deps.installer.load>) => {
    const [scope, files, target, signal] = args;
    if (scope !== "global" || files.length !== 1 || files[0]?.name !== `${planned.updateName}.xml`)
      throw new Error("fault wrapper received an unrelated load");
    await deps.installer.load(...args);
    const capture = (
      await client.query(
        {
          table: TableName.parse("sys_update_xml"),
          query: `name=${planned.updateName}^update_set=${target}`,
          fields: ["sys_id"],
          limit: 1,
        },
        signal,
      )
    )[0]?.["sys_id"];
    if (!capture) throw new Error("the real load produced no capture to withhold");
    const quarantine = await client.writer.insert(
      "sys_update_set",
      {
        name: `${label} withheld capture`,
        application: "global",
        state: "ignore",
        description: "P1 live fault injection, acceptance metadata only",
      },
      signal,
    );
    const id = quarantine["sys_id"];
    if (!id) throw new Error("quarantine update set not created");
    await client.writer.update("sys_update_xml", capture, { update_set: id }, signal);
    const moved = (
      await client.query(
        {
          table: TableName.parse("sys_update_xml"),
          query: `sys_id=${capture}`,
          fields: ["update_set"],
          limit: 1,
        },
        signal,
      )
    )[0];
    if (moved?.["update_set"] !== id) throw new Error("capture was not withheld");
    injected = true;
  },
};
const result = await pushUnits(
  { ...deps, installer },
  { ...query, planId: plan.planId, confirm: true },
);
const journal = await deps.journal.read();
if (
  !injected ||
  result.notApplied !== 0 ||
  result.notCaptured !== 1 ||
  result.ledgerCommit !== null ||
  journal?.pending?.length !== 1
)
  throw new Error(`unexpected fault result: ${JSON.stringify(result)}`);
const evidence = { phase, label, name, recordId: planned.sysId, result, journal };
writeFileSync(
  join(root, `acceptance/${phase}-withheld.json`),
  `${JSON.stringify(evidence, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    phase,
    testPassed: true,
    label,
    name,
    recordId: planned.sysId,
    result,
    journalRetained: true,
  }),
);
