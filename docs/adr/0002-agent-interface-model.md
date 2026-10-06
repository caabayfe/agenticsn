# 0002. Agent interface model: files and CLI first, one small MCP, task-level skills

- Status: Accepted (amended by 0011, 0012, 0019)
- Date: 2026-10-05
- Requirements: ASR-01, ASR-03, ASR-04, ASR-09

## Context

Agent hosts (Claude Code, Codex, Copilot, Cursor and others) share a small set of
building blocks. They differ in context cost, determinism and support across hosts:

| Building block | Purpose | Context cost | Enforces? | Support |
|---|---|---|---|---|
| Files on disk | Facts | None until read | No | Universal |
| Shell / CLI | Actions and queries | None until called | Yes (exit codes) | Universal for coding agents |
| Instructions file (`AGENTS.md`, ...) | Rules that always apply | Always loaded | No | Universal (names vary) |
| Skills | How-to knowledge | Description only; body on demand | No | Most hosts |
| MCP tools | Typed actions | All definitions up front in many hosts | Yes | Most hosts |
| Host hooks | Forced checks around agent actions | None | Yes | Varies |
| Git hooks and CI | Forced checks at commit, PR, promotion | None | Yes | Universal |

v1 exposed 77 MCP tools (about 53 KB of schema per session) and mixed guidance with
enforcement.

## Decision

1. **Files are the main source of context.** Cheap joins are precomputed onto disk. For
   example, `model/tables/<table>.yaml` lists every business rule, client script, UI
   policy, ACL and other behavior of a table in execution order.
2. **The CLI is the main action interface.** It is non-interactive, has bounded output
   and actionable errors, uses stable exit codes, and offers `--format agent|json|text`.
3. **One MCP server** (`snagentic mcp`) with **at most 12 task-level tools**: `status`,
   `search`, `describe_table`, `get_artifact`, `references`, `impact`, `validate`,
   `plan_push`, `push`, `pull`, `audit`, and later `troubleshoot`. Write tools carry
   `destructiveHint` so hosts ask for approval. A different trust boundary gets a
   **profile** of the same server (for example `--profile readonly`), never a separate
   MCP product.
4. **About 8–12 task-level skills**, each holding reference files that load on demand.
   ServiceNow depth lives in those references and in finding remediation text, not in
   the number of skills.
5. **A short instructions file** says what the repo is and that every change goes through
   `snagentic`.
6. **Enforcement only in deterministic places:** the post-edit host hook
   (`check --changed`), the stop hook (`validate`), the gate inside `push`, pre-commit,
   CI on pull requests, and update-set validation before promotion.
7. **Coverage tiers**, so new hosts work immediately:
   - Tier 0: files, CLI, instructions, git hooks, CI.
   - Tier 1: skills.
   - Tier 2: MCP.
   - Tier 3: host hooks, subagents, plugin packaging.

   `snagentic agents install --tool <host>` renders the best tier each host supports
   from one source (`packages/agent-packs`).

## Consequences

- Works with agents that don't exist yet (Tier 0).
- Low standing context cost; knowledge reaches the agent just in time through findings.
- The CLI must be designed for agents. This is a first-class requirement, not an
  afterthought.
- Host capabilities change often, so each host adapter in the agent-pack renderer needs
  verification tests.

## Alternatives considered

- **Several MCP servers per use case.** Rejected. Hosts load the union of their tools,
  configuration multiplies, and the agent must choose between overlapping paths.
- **One MCP with every low-level command, or about 100 skills.** Rejected. Context cost
  and unreliable routing, the problem v1 had.
- **A generic `execute(action, payload)` tool.** Rejected. Weak schemas hide complexity
  and can't be reviewed.
