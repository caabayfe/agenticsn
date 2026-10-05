// Spike S5: how long does linting one changed file take, end to end, in a compiled binary?
import { annotate, argument, resolveBinary, timedRun } from "./process-timing";
import { summarizeTimings } from "./timings";

const RUNS = 50;

const binary = resolveBinary(argument("binary"));
const sample = argument("sample");
const target = argument("target");

const runs = Array.from({ length: RUNS }, () => timedRun([binary, sample]));
const failed = runs.find((run) => run.exitCode !== 0);
if (failed !== undefined) {
  console.error(`lint binary exited with ${failed.exitCode}: ${failed.stdout}`);
  process.exit(1);
}
const reports: { findings: string[]; inProcessMilliseconds: number }[] = runs.map((run) =>
  JSON.parse(run.stdout),
);

const result = {
  spike: "S5",
  target,
  endToEndMilliseconds: summarizeTimings(runs.map((run) => run.milliseconds)),
  inProcessMilliseconds: summarizeTimings(reports.map((report) => report.inProcessMilliseconds)),
  findings: reports[0]?.findings ?? [],
};
await Bun.write(argument("out"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

annotate(
  `S5 ${target}`,
  `end-to-end p50 ${result.endToEndMilliseconds.p50} ms p95 ${result.endToEndMilliseconds.p95} ms; ` +
    `in-process p95 ${result.inProcessMilliseconds.p95} ms; findings ${result.findings.join(" ")}`,
);
