# 0019. The engine is served through MCP; the harness only triggers it

- Status: Accepted
- Date: 2026-10-06
- Requirements: ASR-02, ASR-03, ASR-15; goals G1–G3
- Amends: 0002 (item 4: skills), 0011 (where the agent pack's weight lies)
- Relates to: 0008 (commercial boundary), 0012 (production read-only)
- Detailed design: `specs/003-agent-interface/design.md`

## Context

ADR-0002 put ServiceNow depth in 8–12 skills with reference files, rendered per host by an
agent pack. Reviewing it after v1.0, the product owner asked that governance checks and
advice be part of the MCP server instead. Three facts decide where things belong:

1. **MCP is the one interface every target host shares.** Claude Code, GitHub Copilot (VS
   Code), Cursor and Codex all call MCP tools. Skills, hooks and permission rules differ per
   host or are missing.
2. **An MCP tool runs only when the model chooses to call it**, exactly like a skill is read
   only when the model chooses to read it. Neither can enforce anything (ADR-0011).
3. **A server cannot borrow the host's model.** MCP sampling, the feature that would let a
   server ask the client's model to reason, was deprecated in the 2026-07-28 specification
   (SEP-2577, "integrate directly with LLM provider APIs instead"), and before that only VS
   Code with Copilot supported it; Claude Code and Codex never did. Elicitation (asking the
   user a question during a tool call) remains supported, through the new multi round-trip
   request pattern.

## Decision

The smartness lives in the engine and is served through MCP; the agent's own model does the
reasoning over what the engine returns; deterministic triggers and gates do the enforcing.

| Concern | Lives in | How it reaches the agent |
|---|---|---|
| Rules, findings, remediation | The engine (core + rule packs), deterministic code | MCP `validate`; the CLI; hooks |
| ServiceNow advice and patterns | The engine, computed from the mirror where possible (a table's behavior in execution order, existing rules a change would interact with) | MCP `advise` (and MCP prompts for the main workflows, where hosts support them) |
| Reasoning about that advice | The host agent's model | Reads the tools' structured results |
| Enforcement | The push gate, git hooks, CI, credentials, the promotion guard (ADR-0011) | Not the agent's choice |

1. **One engine.** Every rule, remediation text and piece of ServiceNow guidance ships in the
   binary, versioned and tested with it. CLI, MCP and hooks keep being generated from the same
   registry (ADR-0003).
2. **MCP is the primary agent interface for governance and advice.** v1.1 adds `find`,
   `describe`, `advise`, `validate`, `plan_push` and `push`; the tool budget of ADR-0002 is
   raised as needed, each tool answering a distinct question (design D1). Tool results are
   structured facts plus guidance, written for a model to reason over.
3. **No model inside snagentic, and no dependence on sampling.** snagentic holds no LLM
   credentials and sends no customer data to a model provider; findings never depend on a
   model's output. If a future feature needs server-side reasoning (for example the remote
   read gateway, ADR-0012), it is a separate decision with its own provider integration.
4. **Elicitation where it helps.** A tool that changes an instance asks the user to confirm
   through elicitation when the host supports it, keeping `--confirm` on the CLI and the
   `destructiveHint` annotation for the rest.
5. **Skills are workflows, not knowledge** (design D2). Five workflow skills (design, build,
   review, explain, deliver) say which tool to call and what to do with the answer; ServiceNow
   depth is served by `advise` for the case at hand.
6. **The local harness gets thin.** The agent pack, installed into the workspace (design D3),
   renders only what makes the engine run without the model's choice, plus a short
   instructions file:
   - hooks where the host has them: after an edit `snagentic check --changed`, at the end of a
     turn `validate`; their findings go back to the agent;
   - host permission rules (deny direct HTTP to instances, `--no-verify`, protected paths);
   - one short instructions file and the workflow skills.
7. **Per-host guarantees are documented.** Where a host has no hooks, nothing runs the checks
   during the agent's turn; the push gate, git pre-commit hooks and CI still do, and the
   documentation says so per host.

## Consequences

- The ServiceNow advice that v1 kept in skills is ported into the engine as data and code, with
  tests, instead of markdown. It stays inside the binary (ADR-0008).
- `advise` must keep its answers bounded and relevant; it reads the mirror only.
- The agent interface is tested as product: contract tests, skill trigger evaluations and task
  evaluations with real agents (design D4).
- snagentic uses only Active (non-deprecated) MCP features and records the host matrix in its
  documentation.

## Alternatives considered

- **Skills as the home of ServiceNow depth (ADR-0002 as written; v1's domain skills).**
  Rejected: uneven across hosts, unversioned with the engine, copyable, and static rather than
  computed for the case.
- **MCP sampling to reason inside tools.** Rejected: deprecated, and unsupported by most target
  hosts even before.
- **A model integration inside snagentic.** Rejected for now: new credentials, cost and data
  leaving the machine, for reasoning the host's model already does.
