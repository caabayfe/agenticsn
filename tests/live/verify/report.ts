// Turns a test-plan run's evidence (spec 009) into report.md: L0 per class, L1 per class.
//   bun tests/live/verify/report.ts <evidence run dir>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

interface Tally {
  instance: number;
  mirror: number;
  missing: string[];
  extra: string[];
  compared: number;
  changedSincePull: number;
  differences: Record<string, number>;
  orphans?: number;
}

interface Census {
  table: string;
  records: number;
  buckets: Record<string, number>;
  losses: Record<string, number>;
  reasons: Record<string, number>;
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const count = (n: number) => n.toLocaleString("en-US");

function l0(dir: string): string[] {
  const lines = [
    "## L0. Sync fidelity",
    "",
    "| Group | Class | Instance | Mirror | Missing | Extra | Not mirrored (by design) | Compared field by field | Differences |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const group of readdirSync(dir).sort()) {
    const path = join(dir, group, "summary.json");
    if (!existsSync(path)) continue;
    const summary = read<Record<string, unknown>>(path);
    for (const [table, value] of Object.entries(summary)) {
      if (typeof value !== "object" || value === null) continue;
      const t = value as Tally;
      const differences = Object.entries(t.differences)
        .map(([key, n]) => `${key} (${n})`)
        .join(", ");
      lines.push(
        `| ${group} | ${table} | ${count(t.instance)} | ${count(t.mirror)} | ${t.missing.length} | ${t.extra.length} | ${t.orphans ?? "–"} | ${count(t.compared)} | ${differences || "none"} |`,
      );
    }
  }
  return lines;
}

function l1(dir: string): string[] {
  const lines = [
    "## L1. Adopt census",
    "",
    "| Class | Records | Adoptable | Refused | SDK limit | Failing | Named losses |",
    "|---|---|---|---|---|---|---|",
  ];
  const details: string[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.includes(" "))
    .sort()) {
    const census = read<Census>(join(dir, file));
    const losses = Object.entries(census.losses)
      .map(([loss, n]) => `${loss} (${n})`)
      .join(", ");
    const b = census.buckets;
    lines.push(
      `| ${census.table} | ${count(census.records)} | ${b["adoptable"] ?? 0} | ${b["refused"] ?? 0} | ${b["sdk-limit"] ?? 0} | ${b["failing"] ?? 0} | ${losses || "none"} |`,
    );
    for (const [reason, n] of Object.entries(census.reasons)) {
      details.push(`- **${basename(file, ".json")}**, ${n}: ${reason}`);
    }
  }
  return [...lines, "", "### Refusals and failures", "", ...details];
}

const run = process.argv[2] ?? ".";
const report = [
  `# Test plan run ${basename(run)}`,
  "",
  "Generated from the evidence files of this run (spec 009 test plan). Read-only on the instance.",
  "",
  ...(existsSync(join(run, "L0")) ? l0(join(run, "L0")) : []),
  "",
  ...(existsSync(join(run, "L1")) ? l1(join(run, "L1")) : []),
  "",
];
writeFileSync(join(run, "report.md"), report.join("\n"));
console.log(join(run, "report.md"));
