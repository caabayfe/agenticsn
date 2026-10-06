// Re-applies the current checks to saved runs, without running agents again:
//   bun scripts/eval/rescore.ts .eval-results/<run>
import { join } from "node:path";
import { runChecks } from "./checks";
import { renderReport, summarize } from "./report";
import { SCENARIOS } from "./scenarios";
import { parseClaudeStreams, splitTurns } from "./trace";
import type { RunResult } from "./types";

const dir = process.argv[2] ?? "";
const saved: RunResult[] = await Bun.file(join(dir, "results.json")).json();
const rescored = await Promise.all(
  saved.map(async (run) => {
    const scenario = SCENARIOS.find((s) => s.id === run.scenario);
    if (scenario === undefined) {
      return run;
    }
    const text = await Bun.file(
      join(dir, `${run.scenario}.${run.variant}.${run.repetition}.jsonl`),
    ).text();
    const trace = parseClaudeStreams(splitTurns(text));
    // The end state's validate result was recorded by its check; the files changed with the run.
    const validatePassed = run.checks.find((c) => c.id === "end-state-valid")?.passed ?? null;
    return {
      ...run,
      checks: runChecks(scenario.checks, trace, { changed: run.changed, validatePassed }),
    };
  }),
);
await Bun.write(join(dir, "results.rescored.json"), JSON.stringify(rescored, null, 2));
console.log(renderReport(summarize(rescored), `Rescored: ${dir}`));
