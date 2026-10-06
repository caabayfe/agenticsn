// Runs agent evaluations (spec 003, section 7). Opt-in: real agents, real cost.
//
//   bun run build
//   bun scripts/eval/run.ts --source ~/snagentic/pdi --variants A,B --reps 2
//
// Raw transcripts stay in .eval-results/ (they quote the instance's code: never commit them);
// the Markdown summary is printed and written next to them.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runChecks } from "./checks";
import { runClaude } from "./claude-host";
import { renderReport, summarize } from "./report";
import { SCENARIOS } from "./scenarios";
import { parseClaudeStreams } from "./trace";
import type { RunResult, Scenario, Variant } from "./types";
import { VARIANTS } from "./variants";
import { changesSince, ensureSlot, prepareVariant, resetTo } from "./workspace";

const { values } = parseArgs({
  options: {
    source: { type: "string", default: join(homedir(), "snagentic/pdi") },
    scenarios: { type: "string" },
    kind: { type: "string" },
    variants: { type: "string", default: "A" },
    reps: { type: "string", default: "1" },
    model: { type: "string", default: "sonnet" },
    budget: { type: "string", default: "3" },
    timeout: { type: "string", default: "900" },
    slot: { type: "string", default: join(tmpdir(), "snagentic-eval", "slot-1") },
    binary: { type: "string", default: resolve("dist/snagentic") },
  },
});

const pick = <T extends { id: string }>(all: readonly T[], list: string | undefined) =>
  list === undefined ? [...all] : all.filter((item) => list.split(",").includes(item.id));

const scenarios = pick(SCENARIOS, values.scenarios).filter(
  (scenario) => values.kind === undefined || scenario.kind === values.kind,
);
const variants = pick(VARIANTS, values.variants);
const reps = Number(values.reps);
const outDir = join(".eval-results", new Date().toISOString().replaceAll(":", "-").slice(0, 19));
await mkdir(outDir, { recursive: true });

async function runOne(
  scenario: Scenario,
  variant: Variant,
  base: string,
  rep: number,
): Promise<RunResult> {
  await resetTo(values.slot, base);
  await scenario.prepare?.(values.slot);
  const trigger = scenario.kind === "trigger";
  const streams = await runClaude(values.slot, scenario.turns, variant, {
    model: values.model,
    budgetUsd: trigger ? 0.3 : Number(values.budget),
    timeoutSeconds: trigger ? 120 : Number(values.timeout),
    binary: values.binary,
  });
  await writeFile(join(outDir, `${scenario.id}.${variant.id}.${rep}.jsonl`), streams.join("\n"));
  const trace = parseClaudeStreams(streams);
  const changes = await changesSince(values.slot, base, values.binary);
  return {
    scenario: scenario.id,
    variant: variant.id,
    repetition: rep,
    checks: runChecks(scenario.checks, trace, changes),
    changed: changes.changed,
    costUsd: trace.costUsd,
    seconds: trace.seconds,
    toolCalls: trace.calls.length,
    model: trace.model,
    error: trace.error,
  };
}

console.error(`preparing ${values.slot} from ${values.source}`);
await ensureSlot(values.source, values.slot);
const results: RunResult[] = [];
for (const variant of variants) {
  const base = await prepareVariant(values.slot, variant, values.binary);
  for (const scenario of scenarios) {
    for (let rep = 1; rep <= reps; rep += 1) {
      const result = await runOne(scenario, variant, base, rep);
      results.push(result);
      await writeFile(join(outDir, "results.json"), JSON.stringify(results, null, 2));
      const failed = result.checks.filter((check) => !check.passed).map((check) => check.id);
      console.error(
        `${variant.id} ${scenario.id} #${rep}: ${failed.length === 0 ? "pass" : `fail (${failed.join(", ")})`} $${result.costUsd.toFixed(2)} ${Math.round(result.seconds)}s`,
      );
    }
  }
}
const report = renderReport(summarize(results), `Agent evaluation, ${values.model}`);
await writeFile(join(outDir, "report.md"), report);
console.log(report);
