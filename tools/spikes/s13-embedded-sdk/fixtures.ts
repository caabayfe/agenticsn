// Spike S13, tests A1, A3 and A4 on any platform: build every fixture project from the binary,
// in a folder with no node_modules, and compare the normalized records with the `now-sdk` CLI's
// output committed next to it (`expected/`, built on macOS with Node).
//   bun fixtures.ts --binary <embed binary> --fixtures <dir> --target <name>
//     [--startup <snagentic binary>,<snagentic with SDK binary>]
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { annotate, argument, resolveBinary, timedRun } from "../../../scripts/process-timing";
import { summarizeTimings } from "../../../scripts/timings";
import { normalizedRecords } from "./normalize";

const binary = resolveBinary(resolve(argument("binary")));
const fixtures = resolve(argument("fixtures"));
const target = argument("target");
const work = mkdtempSync(join(tmpdir(), "s13-fixtures-"));

function differences(expected: Map<string, string>, actual: Map<string, string>): string[] {
  const keys = new Set([...expected.keys(), ...actual.keys()]);
  return [...keys].filter((k) => expected.get(k) !== actual.get(k)).sort();
}

function buildOnce(fixture: string, copy: string): { ms: number; records: Map<string, string> } {
  const dir = join(work, copy);
  cpSync(join(fixtures, fixture), dir, {
    recursive: true,
    filter: (p) => !p.startsWith(join(fixtures, fixture, "expected")),
  });
  const run = timedRun([binary, dir]);
  if (run.exitCode !== 0 || !run.stdout.includes("success: true")) {
    throw new Error(`${fixture}: build failed (exit ${run.exitCode}): ${run.stdout.slice(-400)}`);
  }
  return { ms: Math.round(run.milliseconds), records: normalizedRecords(join(dir, "dist", "app")) };
}

let failed = false;
const lines: string[] = [];
for (const fixture of readdirSync(fixtures).sort()) {
  const expected = normalizedRecords(join(fixtures, fixture, "expected"));
  try {
    const first = buildOnce(fixture, `${fixture}-1`);
    const second = buildOnce(fixture, `${fixture}-2`);
    const vsCli = differences(expected, first.records);
    const vsSelf = differences(first.records, second.records);
    const ok = vsCli.length === 0 && vsSelf.length === 0;
    failed ||= !ok;
    lines.push(
      `${ok ? "pass" : "FAIL"} ${fixture}: ${first.records.size} records, ${first.ms} ms` +
        (vsCli.length ? `; differs from CLI: ${vsCli.join(" ")}` : "") +
        (vsSelf.length ? `; differs between builds: ${vsSelf.join(" ")}` : ""),
    );
  } catch (error) {
    failed = true;
    lines.push(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  }
}

const startupIndex = process.argv.indexOf("--startup");
if (startupIndex !== -1) {
  const pair = (process.argv[startupIndex + 1] ?? "").split(",").map((b) => resolveBinary(b));
  const p95 = pair.map(
    (b) =>
      summarizeTimings(Array.from({ length: 30 }, () => timedRun([b, "--version"]).milliseconds))
        .p95,
  );
  lines.push(`start-up --version p95: snagentic ${p95[0]} ms, with SDK ${p95[1]} ms`);
}

rmSync(work, { recursive: true, force: true });
console.log(lines.join("\n"));
annotate(`S13 ${target}`, lines.join("; "));
if (failed) process.exit(1);
