# S5. Hook latency

- Date: 2026-10-05
- Confirms: ASR-04 (post-edit check < 300 ms p95 end to end), ADR-0006 (ESLint rule API)
- Verdict: **go** on macOS arm64, Windows x64, Linux x64 and Linux arm64. **Borderline**
  on the macOS x64 CI runner.

## Question

Can a compiled binary load the ESLint `Linter`, register a ServiceNow-style rule and lint
one changed file fast enough to run after every agent edit?

## Method

`tools/spikes/s5-lint-latency/lint-once.ts` (throwaway, not product code) is compiled
into its own binary. It loads `eslint/universal`, adds `sn/no-gliderecord-in-loop` and
the built-in `no-eval`, and lints a realistic 60-line after-update business rule
(`sample-business-rule.js`). `scripts/measure-s5.ts` runs it 50 times per platform:
end-to-end process time, and in-process time (load ESLint + lint).

## Results (p95, ranges over runs on 2026-10-05)

| Platform | End to end | In process |
|---|---|---|
| macOS arm64 (CI) | 111–141 ms | 77–98 ms |
| macOS arm64 (developer machine) | 34 ms | 20 ms |
| macOS x64 (CI) | 300 ms | 130–167 ms |
| Windows x64 (CI) | 107–145 ms | 66–94 ms |
| Linux x64 (CI) | 76–103 ms | 52–72 ms |
| Linux arm64 (CI) | 86–92 ms | 61–65 ms |

Every run found exactly the expected finding (`sn/no-gliderecord-in-loop:33`): the
GlideRecord created inside the `for` loop. It did not flag the one created before the
`while` loop.

## Findings

- Comfortably within budget (2–4× headroom) everywhere except the macOS Intel CI runner,
  which sits at the budget on a machine that is also slow to start any process.
- Most in-process time is loading ESLint, not linting. That fixed cost is paid on every
  hook call.

## Decision

Go. Keep the fallback from ADR-0005 ready: route hook checks through the already-running
`snagentic mcp` process (ESLint loaded once) if real rule packs push latency up. Re-measure
in phase 2 with the real rule engine and rules-basic.
