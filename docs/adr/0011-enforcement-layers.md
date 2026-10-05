# 0011. Enforcement layers

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-02, ASR-03, ASR-15
- Amends: 0002, 0004, 0010

## Context

Guardrails must hold even when the agent doesn't follow instructions. A control is only as
strong as the party able to bypass it, so each control must be placed according to whom
it is meant to stop:

| Actor | Typical failure | Must be stopped by |
|---|---|---|
| **Agent**, including one manipulated by prompt injection in instance data | Takes a shortcut around the tool, ignores a finding, calls the API directly | Controls the agent can't change: host permissions, the push gate, credentials |
| **Developer** | Disables hooks, uses `--no-verify`, builds in the browser | Controls outside the developer's machine: git server, CI, the target instance |
| **Instance admin** | Disables controls inside ServiceNow | Out of our control. Make it visible through instance audit |

Skills and instructions are guidance. **They never count as enforcement.**

## Decision

Enforcement is layered along the path from the agent to production. Each layer has one
responsibility:

| # | Layer | Mechanism | Stops | Phase |
|---|---|---|---|---|
| 1 | Host hooks | Post-edit `check --changed`; stop-hook `validate`; pre-tool hook blocking protected paths (`_children/`, `.snagentic/`, mirror branch) | Agent mistakes, immediately | 2 |
| 2 | **Host permissions** | Rendered by the agent pack: deny direct HTTP to instance URLs, deny `--no-verify`, deny writes to protected paths, ask before `snagentic push` | **The agent working around snagentic** | 2 |
| 3 | Push gate | `push` requires a plan id, a passing gate and an unchanged base hash (ADR-0006) | Unvalidated pushes through the tool | 3 |
| 4 | Local git hooks | pre-commit and pre-push run `validate` | Bad commits (the developer can bypass these) | 2 |
| 5 | **Git server and CI** | Branch protection with required status checks; governed-mode push from CI | Anything merged, regardless of the developer | 5 |
| 6 | **Credential isolation** | In governed mode, agents and developers hold no write credentials. For production, see ADR-0012 | Every direct-API bypass | 3 / 6 |
| 7 | CI promotion validation | `validate --update-set` before promotion | Browser-built work promoted through CI | 5 |
| 8 | **ServiceNow roles** | Documented least-privilege roles per instance kind and mode, checked by `snagentic doctor` | What a credential can do at all | 1 |
| 9 | **Promotion guard** (optional component) | Small scoped app on test and production. CI writes a verdict record (update set identity, payload hash, result) using a CI-only role. A business rule blocks committing a retrieved update set without a matching passing verdict | **Everything**, including manual promotion and browser work | 5 |

Layers 1–4 help the agent do the right thing. Layers 5–9 hold when the tool is bypassed.

### Not adopted now

- **Publishing rules as native Instance Scan checks.** Useful for teams without CI, but
  they are limited to single-record checks and duplicate rule maintenance. Revisit after
  v1.

## Consequences

- The agent pack renders host permission rules as well as hooks. Each host adapter needs
  tests confirming they are applied.
- The promotion guard is a second deliverable (a ServiceNow scoped app). It is optional,
  aimed at customers who promote by hand, and must be maintained across ServiceNow
  releases.
- Documentation must state, for each operating mode, which layers are active, so
  customers know exactly what is guaranteed.

## Alternatives considered

- **Rely on host hooks and skills only.** Rejected. Developers can bypass hooks, and
  skills are probabilistic.
- **Rely on CI only.** Rejected as the only layer. It misses manual promotion and gives
  late feedback to agents.
