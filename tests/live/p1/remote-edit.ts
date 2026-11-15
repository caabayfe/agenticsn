import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { JsonPushJournalStore } from "../../../packages/cli/src/adapters/state/json-push-journal-store";
import {
  settle,
  switchFor,
} from "../../../packages/core/src/delivery/application/push-preferences";
import { userSysId } from "../../../packages/core/src/delivery/application/push-steps";
import { type PushJournal, TableName } from "../../../packages/core/src/index";
import { dependencies } from "./dependencies";

const [root = ""] = process.argv.slice(2);
if (!root) throw new Error("acceptance workspace required");
const saved = JSON.parse(readFileSync(join(root, "acceptance/drift-withheld.json"), "utf8"));
const { recordId, label, name } = saved;
const set = saved.result.batch.sysId;
if (
  name !== "p1-accept-pdi11-20261114.pending_drift" ||
  label !== "p1-accept-pdi11-20261114-drift" ||
  !/^[a-f0-9]{32}$/.test(recordId) ||
  !/^[a-f0-9]{32}$/.test(set)
)
  throw new Error("unexpected acceptance target");
const { deps, client } = await dependencies(root);
const session = { reader: client, writer: client.writer, signal: deps.signal };
const binary = resolve(import.meta.dir, "../../../dist/snagentic");

async function command(args: readonly string[]) {
  const child = Bun.spawn(
    [
      binary,
      ...args,
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
  if (!stdout.trim()) throw new Error(`CLI returned no structured output: ${stderr}`);
  return { code, output: JSON.parse(stdout) };
}

const reviewed = await command(["plan-push"]);
if (
  reviewed.code !== 0 ||
  reviewed.output.ready !== true ||
  reviewed.output.units.length !== 1 ||
  reviewed.output.units[0].operation !== "load"
)
  throw new Error("expected a reviewed pending retry before the external edit");
writeFileSync(
  join(root, "acceptance/drift-before-edit-plan.json"),
  `${JSON.stringify(reviewed.output, null, 2)}\n`,
);
const property = (
  await client.query(
    {
      table: TableName.parse("sys_properties"),
      query: `sys_id=${recordId}`,
      fields: ["sys_id", "name", "value", "sys_mod_count", "sys_updated_on"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
if (property === undefined || property["name"] !== name || property["value"] !== "source value")
  throw new Error("property no longer has the expected test state");
const target = (
  await client.query(
    {
      table: TableName.parse("sys_update_set"),
      query: `sys_id=${set}`,
      fields: ["name", "application", "state"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
if (
  target?.["name"] !== `snagentic: ${label}` ||
  target["application"] !== "global" ||
  target["state"] !== "in progress"
)
  throw new Error("test update set changed");

// Keep this intentional outside edit in the test's own update set, then restore the user's
// current application and update set even if the write fails. The receipt stays separate.
const store = new JsonPushJournalStore(join(root, "acceptance/manual-preferences"));
if ((await store.read()) !== null)
  throw new Error("unfinished manual preference restore requires inspection");
const journal: { current: PushJournal } = {
  current: {
    planId: "p1-external-edit",
    mirrorCommit: "",
    startedAt: new Date().toISOString(),
    preferences: [],
    steps: [],
  },
};
const save = (preferences: PushJournal["preferences"]) => {
  journal.current = { ...journal.current, preferences };
  return store.write(journal.current);
};
const user = await userSysId(session, "admin");
await store.write(journal.current);
try {
  await switchFor(session, { user, name: "apps.current_app", value: "global" }, journal, save);
  await switchFor(session, { user, name: "sys_update_set", value: set }, journal, save);
  await client.writer.update(
    "sys_properties",
    recordId,
    { value: "external acceptance edit" },
    deps.signal,
  );
} finally {
  await settle(session, journal, save);
  await store.clear();
}
const afterEdit = (
  await client.query(
    {
      table: TableName.parse("sys_properties"),
      query: `sys_id=${recordId}`,
      fields: ["value", "sys_mod_count"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
const blocked = await command(["plan-push"]);
if (
  blocked.code === 0 ||
  blocked.output.ready !== false ||
  !blocked.output.problems.some((problem: { reason: string }) =>
    problem.reason.includes("instance changed"),
  )
)
  throw new Error("remote edit was not blocked");
const refused = await command(["push", "--plan", reviewed.output.planId, "--confirm"]);
if (refused.code === 0) throw new Error("old reviewed plan unexpectedly wrote after drift");
const afterRefusal = (
  await client.query(
    {
      table: TableName.parse("sys_properties"),
      query: `sys_id=${recordId}`,
      fields: ["value", "sys_mod_count"],
      limit: 1,
    },
    deps.signal,
  )
)[0];
if (
  afterEdit?.["value"] !== "external acceptance edit" ||
  afterEdit["sys_mod_count"] !== afterRefusal?.["sys_mod_count"] ||
  afterRefusal?.["value"] !== afterEdit["value"] ||
  (await deps.journal.read()) === null
)
  throw new Error("refusal did not preserve remote edit and pending receipt");
writeFileSync(
  join(root, "acceptance/drift-blocked.json"),
  `${JSON.stringify({ blocked, refused, afterEdit, afterRefusal }, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    testPassed: true,
    planBlocked: true,
    pushRefused: true,
    externalEditPreserved: true,
    journalRetained: true,
    blockedPlan: blocked.output,
    refusal: refused.output,
  }),
);
