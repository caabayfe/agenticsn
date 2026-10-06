# Agent evaluation baseline (2026-10-06)

The first run of the evaluation harness (spec 003, sections 7 and 14): Claude Code 2.1.285
(`sonnet`, resolving to claude-sonnet-5-5), headless, on a clone of the PDI workspace whose
instance is unreachable. 110 runs, $10.89 in all. Two runs per cell: read differences of one
run (50%) as noise, and only consistent patterns as findings.

## Experiment 1: how much should the always-loaded instructions say?

| Variant | Instructions | MCP server |
|---|---|---|
| A | as shipped (about 20 lines) | yes |
| B | A plus a question-to-tool map and the CLI fallback | yes |
| C | B plus ServiceNow practice spelled out | yes |
| A-cli, B-cli | A and B | no: the agent uses the `snagentic` CLI |

| Scenario | A | B | C | A-cli | B-cli |
|---|---|---|---|---|---|
| explain-assignment | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| explain-state-on-assignment | 100% (2) | 50% (2) | 100% (2) | 100% (2) | 50% (2) |
| design-notify-p1 | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| build-mandatory-business-service | 50% (2) | 100% (2) | 50% (2) | 100% (2) | 100% (2) |
| review-risky-change | 100% (2) | 100% (2) | 50% (2) | 100% (2) | 0% (2) |
| trigger-explain-why | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| trigger-explain-where | 100% (2) | 0% (2) | 0% (2) | 100% (2) | 0% (2) |
| trigger-design-field | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| trigger-review | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| trigger-none-python | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| trigger-none-js | 100% (2) | 100% (2) | 100% (2) | 100% (2) | 100% (2) |

- A: 22 runs, $2.20, 95% mean pass rate
- B: 22 runs, $2.11, 86% mean pass rate
- C: 22 runs, $2.05, 82% mean pass rate
- A-cli: 22 runs, $2.30, 100% mean pass rate
- B-cli: 22 runs, $2.21, 77% mean pass rate

## Checks that did not always pass

- build-mandatory-business-service / A: asks-approval-turn-1 passed 50%
- build-mandatory-business-service / A: changed-metadata passed 50%
- build-mandatory-business-service / A: least-custom-option passed 50%
- build-mandatory-business-service / A: validated-after-last-edit passed 50%
- explain-state-on-assignment / B: cites-2-paths passed 50%
- trigger-explain-where / B: skill-servicenow-explain passed 0%
- build-mandatory-business-service / C: changed-metadata passed 50%
- build-mandatory-business-service / C: least-custom-option passed 50%
- build-mandatory-business-service / C: validated-after-last-edit passed 50%
- review-risky-change / C: cites-the-file passed 50%
- trigger-explain-where / C: skill-servicenow-explain passed 0%
- explain-state-on-assignment / B-cli: cites-2-paths passed 50%
- review-risky-change / B-cli: cites-the-file passed 0%
- trigger-explain-where / B-cli: skill-servicenow-explain passed 0%


Per task run (task scenarios only):

| Variant | Cost | Time | Tool calls |
|---|---|---|---|
| A | $0.15 | 30 s | 10.5 |
| B | $0.14 | 31 s | 10.6 |
| C | $0.14 | 29 s | 9.9 |
| A-cli | $0.16 | 38 s | 9.8 |
| B-cli | $0.16 | 39 s | 10.0 |

### Reading

- **The shipped instructions (A) do as well as or better than longer ones, with or without
  MCP.** More text cost the same and did not raise any score.
- **The tool map diverts agents from the skills.** With it, "where is the incident number
  prefix defined?" went straight to `find` in all six runs of B, C and B-cli, never loading
  `servicenow-explain`; A and A-cli loaded it every time. Skills carry the parts tools do not
  (cite paths, follow `usedBy`, say what the mirror cannot show), so routing around them is a
  loss even when the answer is right.
- **The CLI fallback line was not needed.** Without MCP and without that line (A-cli), agents
  found the CLI through `snagentic --help` and passed every scenario.
- The build scenario's misses in A and C are one run each: the agent stopped to ask about
  child records (fixed in #22, see below) or built in a way the checks did not expect.

**Decision proposed: keep the instructions as shipped (A).** Re-run the experiment with more
repetitions when the pack changes materially.

## Product defects the baseline found (all fixed)

| Finding | Fix |
|---|---|
| Claude Code reads skills only from `.claude/skills` | #18 |
| `describe incident` returned 112 KB, over Claude Code's MCP result limit | #20: results within about 6,000 tokens, `phase` for the rest |
| An agent read "never edit child-row files" as "never create child records" and stopped building a UI policy | #22: the rule names the files |
| A new record under a file name pull would not give it (two files after the next pull) | #22: plan reports it |
| `find` needed text to list records by class | #22 |
| Number records (`INC`) had no table in the index, so an agent concluded they were not mirrored | #25 |

## Caveats

- Variant A ran before `plan_push` existed, so it saw one tool fewer. A-cli and B-cli ran with a
  later binary that also installs the Claude Code hooks and permission rules. Neither changes
  the scenarios measured here, but the next baseline should run every variant on one binary
  (pass `--binary` with a frozen copy).
- The first scoring missed CLI tool calls (`snagentic describe` through Bash) and every task in
  A-cli and B-cli scored 0%; the checks were fixed and all runs re-scored from their
  transcripts (`bun scripts/eval/rescore.ts`). Transcripts are kept locally only: they quote
  instance code.
- Delivery (`plan_push`, `push`) is not covered yet: the clone's instance is unreachable on
  purpose, and `plan_push` reads open update sets. It needs a recorded or fake instance.
