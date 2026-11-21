// The first step of the nightly live run (spec 016, T1): prepares the workspace the live tests
// read their instance profile from, and asks the instance one signed-in question. Reads the
// settings docs/guides/live-tests.md names from the environment; prints no value of them.
//   bun scripts/check-live-instance.ts <new workspace folder>
// Exit 0 with output `state` = ready | not-configured | asleep; exit 1 when the instance refused.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { answerOf, TableName } from "../packages/core/src/index";
import { liveClient } from "../tests/live/verify/live-connection";
import {
  githubReport,
  LIVE_INSTANCE,
  missingSettings,
  notConfigured,
  type Preflight,
  preflightOf,
} from "./live-preflight";

const MAIN = resolve(import.meta.dir, "../packages/cli/src/main.ts");

function finish(preflight: Preflight): never {
  const report = githubReport(preflight);
  if (report.annotation !== null) console.log(report.annotation);
  console.log(`${preflight.title}: ${preflight.message}`);
  const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, report.output);
  if (GITHUB_STEP_SUMMARY) appendFileSync(GITHUB_STEP_SUMMARY, report.summary);
  process.exit(preflight.state === "failed" ? 1 : 0);
}

function snagentic(...args: string[]): void {
  const result = Bun.spawnSync(["bun", MAIN, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`snagentic ${args[0]} failed: ${result.stderr.toString()}`);
  }
}

const missing = missingSettings(process.env);
if (missing.length > 0) finish(notConfigured(missing));

const workspace = resolve(process.argv[2] ?? "");
if (process.argv[2] === undefined) throw new Error("usage: check-live-instance.ts <workspace>");
const { SNAGENTIC_PDI_URL = "", SNAGENTIC_PDI_USERNAME = "" } = process.env;
snagentic("init", workspace);
snagentic(
  ...["instance", "add", LIVE_INSTANCE, "--kind", "development", "--workspace", workspace],
  ...["--url", SNAGENTIC_PDI_URL, "--username", SNAGENTIC_PDI_USERNAME],
);

// One row of one property, by its indexed name: the smallest read that needs the sign-in.
const answer = await answerOf(LIVE_INSTANCE, async () => {
  const client = await liveClient(LIVE_INSTANCE, workspace);
  const query = {
    table: TableName.parse("sys_properties"),
    query: "name=glide.war",
    fields: ["name"],
    limit: 1,
  };
  await client.query(query, AbortSignal.timeout(120_000));
});
finish(preflightOf(answer));
