# 0012. Production access is read-only by construction

- Status: Accepted, pending the read-only role spike (amended by 0013)
- Date: 2026-10-05
- Requirements: ASR-02, ASR-08, ASR-15
- Amends: 0002, 0003, 0004, 0010

## Context

Troubleshooting production is valuable (G2), but production must never be written by
this product. Neither skills nor MCP alone can guarantee that:

- **Skills and agent definitions** are instructions to a probabilistic model. In
  production, the agent also reads untrusted text (incident descriptions, comments,
  emails, logs), so **prompt injection** is a realistic way to steer it.
- **A local MCP server or CLI** runs as the same OS user as the agent. If the agent has a
  shell, it can read the same credentials and call the REST API directly. CLI vs MCP is
  not a security boundary. What matters is **where the credential lives** and **what it
  is allowed to do**.

The guarantee must therefore come from something the agent can't reach or influence.

## Decision

Production access is read-only through five independent layers. Any one of the first
four prevents writes on its own.

| # | Layer | Mechanism |
|---|---|---|
| 1 | **ServiceNow platform** (the hard guarantee) | The production user has the `snc_read_only` role plus only the read roles troubleshooting needs. Where available, an OAuth client restricted by REST API access policy or auth scope to read APIs |
| 2 | **Credential isolation** | In team and governed modes, the production credential lives only in the **read gateway** (remote MCP, production profile). Agents authenticate to the gateway with their own identity and never hold the production credential |
| 3 | **Tool surface** | For instances of kind `production` (and `test`), write use cases are **not registered** in the CLI, MCP or hooks. They aren't merely refused; they don't exist |
| 4 | **Self-verification** | Before any call to a production profile, snagentic checks the credential's roles (`snc_read_only` present, no write-granting roles). If the check fails, it refuses to operate and explains why |
| 5 | **Data and load protection** | Field redaction, row and time-window budgets, filters that must hit indexes, rate limiting, and an audit log of every query. Production business data is never written to git and is kept on disk only as short-lived, redacted responses |

### Deployment

- **Solo mode:** the local CLI or MCP with a read-only production credential. Layers 1,
  3, 4 and 5 apply; credential isolation (layer 2) does not.
- **Team and governed modes:** the **read gateway**, a remote MCP over HTTP running the
  same code with a read-only profile. This resolves the earlier "remote MCP" open
  question.

### Actions that look like reads but write (never tools for production)

These are excluded from production:
- enabling debug logging (system properties) or session debug;
- running background scripts;
- executing scheduled jobs, ATF tests or flows;
- flushing caches;
- impersonating users;
- calling scripted REST endpoints, which can write even on GET.

The troubleshooting skill tells the agent to **recommend** them to a human. Fixes always
go through development, an update set, validation and promotion.

### Production troubleshooting tools (phase 6, all read-only and bounded)

- system and transaction logs within time windows;
- slow transactions and slow queries;
- record history (`sys_audit`);
- production drift (production metadata vs the mirror);
- explaining a record's execution path, using the mirrored table model plus a redacted
  production record;
- job and flow execution status.

## Consequences

- Layers 3 and 4 are required from **phase 1**, because pull already connects to test and
  production instances.
- The read gateway is a new deployment artifact for phase 6, with its own authentication
  for agents.
- Customers must create a dedicated read-only integration user. Setup documentation and
  `snagentic doctor` cover this.
- Troubleshooting output contains business data that reaches the model provider.
  Redaction policy and budgets are part of the product, not an option.

## Validation spike

- Confirm `snc_read_only` behavior on current ServiceNow releases, including system writes
  it still allows (for example session or preference records).
- Confirm which REST API access policy and OAuth scope options exist to restrict a client
  to read APIs.
- Confirm the role check in layer 4 can be done with the read-only credential itself.

## Deferred

- **An agentic troubleshooting console running inside ServiceNow.** It has different
  security properties (identity, data residency, platform AI controls). It will be
  reviewed in a later stage as its own ADR.

## Alternatives considered

- **Skills and agent definitions only.** Rejected. Probabilistic, and exposed to prompt
  injection from production data.
- **Local MCP as the boundary.** Rejected as a guarantee. The agent can reach the same
  credentials through its shell. Still useful as a typed, audited path.
- **Refusing writes in code without registering them conditionally.** Rejected. A missing
  code path is safer than a guarded one.

## Implementation status (2026-10-06)

- Layer 4 runs on every connection to a test or production instance (`pull`, `update-sets`):
  one request checks that the user holds `snc_read_only`, and snagentic refuses before
  asking anything else. Verified live with a writable credential on a test profile.
- Layer 3 is enforced centrally: a use case flagged `requiresDevelopmentInstance` is refused
  for any other kind before its handler runs. Removing such tools from the MCP surface for
  non-development instances comes with M7.
