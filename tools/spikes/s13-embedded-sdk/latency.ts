// Spike S13, test A5: does embedding the SDK slow commands that do not use it?
//   bun latency.ts --workspace <dir> --file <record file> --binaries <a,b,...> [--runs 50]
// Runs `--version` and `check <file>` from the workspace, alternating binaries per round so
// machine noise falls on all of them alike.
import { argument, timedRun } from "../../../scripts/process-timing";
import { summarizeTimings } from "../../../scripts/timings";

const workspace = argument("workspace");
const file = argument("file");
const binaries = argument("binaries").split(",");
const runsIndex = process.argv.indexOf("--runs");
const runs = runsIndex === -1 ? 50 : Number(process.argv[runsIndex + 1]);

process.chdir(workspace);
const samples = new Map(
  binaries.map((b) => [b, { version: [] as number[], check: [] as number[] }]),
);
for (let round = 0; round < runs; round++) {
  for (const binary of binaries) {
    const entry = samples.get(binary);
    if (entry === undefined) continue;
    entry.version.push(timedRun([binary, "--version"]).milliseconds);
    const check = timedRun([binary, "check", file, "--format", "json"]);
    if (round === 0 && !check.stdout.includes('"passed"')) {
      console.error(`${binary}: unexpected check output: ${check.stdout.slice(0, 300)}`);
      process.exit(1);
    }
    entry.check.push(check.milliseconds);
  }
}
for (const [binary, { version, check }] of samples) {
  const v = summarizeTimings(version);
  const c = summarizeTimings(check);
  console.log(
    `${binary}\n  --version  p50 ${v.p50} p95 ${v.p95} max ${v.max}\n` +
      `  check      p50 ${c.p50} p95 ${c.p95} max ${c.max}`,
  );
}
