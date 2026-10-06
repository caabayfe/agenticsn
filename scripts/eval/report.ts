import type { RunResult } from "./types";

export interface CellSummary {
  readonly scenario: string;
  readonly variant: string;
  readonly runs: number;
  // Share of runs in which every check passed.
  readonly passRate: number;
  // Per check, the share of runs it passed in.
  readonly checks: Readonly<Record<string, number>>;
  readonly meanCostUsd: number;
  readonly meanSeconds: number;
  readonly errors: number;
}

const mean = (values: readonly number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

export function summarize(results: readonly RunResult[]): CellSummary[] {
  const cells = new Map<string, RunResult[]>();
  for (const result of results) {
    const key = `${result.scenario}\u0000${result.variant}`;
    cells.set(key, [...(cells.get(key) ?? []), result]);
  }
  return [...cells.values()].map((runs) => {
    const ids = [...new Set(runs.flatMap((run) => run.checks.map((check) => check.id)))];
    return {
      scenario: runs[0]?.scenario ?? "",
      variant: runs[0]?.variant ?? "",
      runs: runs.length,
      passRate: mean(runs.map((run) => (run.checks.every((check) => check.passed) ? 1 : 0))),
      checks: Object.fromEntries(
        ids.map((id) => [
          id,
          mean(runs.map((run) => (run.checks.find((check) => check.id === id)?.passed ? 1 : 0))),
        ]),
      ),
      meanCostUsd: mean(runs.map((run) => run.costUsd)),
      meanSeconds: mean(runs.map((run) => run.seconds)),
      errors: runs.filter((run) => run.error !== null).length,
    };
  });
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

// A Markdown report: one table of scenarios by variant, then the checks that failed.
export function renderReport(cells: readonly CellSummary[], title: string): string {
  const variants = [...new Set(cells.map((cell) => cell.variant))];
  const scenarios = [...new Set(cells.map((cell) => cell.scenario))];
  const cell = (scenario: string, variant: string) =>
    cells.find((c) => c.scenario === scenario && c.variant === variant);
  const rows = scenarios.map((scenario) => {
    const values = variants.map((variant) => {
      const c = cell(scenario, variant);
      return c === undefined ? "" : `${percent(c.passRate)} (${c.runs})`;
    });
    return `| ${scenario} | ${values.join(" | ")} |`;
  });
  const totals = variants.map((variant) => {
    const mine = cells.filter((c) => c.variant === variant);
    const cost = mine.reduce((sum, c) => sum + c.meanCostUsd * c.runs, 0);
    const runs = mine.reduce((sum, c) => sum + c.runs, 0);
    return `${variant}: ${runs} runs, $${cost.toFixed(2)}, ${percent(mean(mine.map((c) => c.passRate)))} mean pass rate`;
  });
  const failing = cells.flatMap((c) =>
    Object.entries(c.checks)
      .filter(([, share]) => share < 1)
      .map(([id, share]) => `- ${c.scenario} / ${c.variant}: ${id} passed ${percent(share)}`),
  );
  return [
    `# ${title}`,
    "",
    "Share of runs in which every check passed (runs in brackets).",
    "",
    `| Scenario | ${variants.join(" | ")} |`,
    `|---|${variants.map(() => "---").join("|")}|`,
    ...rows,
    "",
    ...totals.map((line) => `- ${line}`),
    "",
    "## Checks that did not always pass",
    "",
    ...(failing.length === 0 ? ["None."] : failing),
    "",
  ].join("\n");
}
