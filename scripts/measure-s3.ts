// Spike S3: does the compiled binary run doctor on this platform, and how fast does it start?
import { annotate, argument, resolveBinary, sizeInMegabytes, timedRun } from "./process-timing";
import { summarizeTimings } from "./timings";

const STARTUP_RUNS = 20;

const binary = resolveBinary(argument("binary"));
const target = argument("target");

const startup = summarizeTimings(
  Array.from({ length: STARTUP_RUNS }, () => timedRun([binary, "--version"]).milliseconds),
);
const doctorRun = timedRun([binary, "doctor", "--format", "json"]);
const doctor: { ok: boolean; checks: { name: string; status: string; detail: string }[] } =
  JSON.parse(doctorRun.stdout);

const result = {
  spike: "S3",
  target,
  platform: process.platform,
  arch: process.arch,
  sizeMegabytes: sizeInMegabytes(binary),
  startupMilliseconds: startup,
  doctorExitCode: doctorRun.exitCode,
  doctor,
};
await Bun.write(argument("out"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

const checks = doctor.checks.map((check) => `${check.name} ${check.status}`).join(", ");
annotate(
  `S3 ${target}`,
  `size ${result.sizeMegabytes} MB; start p50 ${startup.p50} ms p95 ${startup.p95} ms; ` +
    `doctor exit ${doctorRun.exitCode} (${checks})`,
);
if (doctorRun.exitCode !== 0) {
  process.exit(1);
}
