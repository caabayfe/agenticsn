# 0006. Governance validates any change source with three rule tiers

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-03, ASR-10, ASR-11, ASR-12, ASR-14

## Context

G3 requires validating capabilities for architecture, performance and security. Changes
come from agents editing files, from people building update sets in the browser, and from
pull requests. v1 only reviewed local changes, stored update sets without their payloads,
and used a hand-written lexer that limited how deep analysis could go.

## Decision

### Change sources

Governance takes a `ChangeSet`, produced by one of three `ChangeSource` adapters:

| Source | Use | How |
|---|---|---|
| `workspace` | Agent feedback, `plan` | Working tree vs mirror Snapshot |
| `git-range` | Pull request checks | `base..head` diff |
| `update-set` | Validation before promotion | `sys_update_xml` payload XML parsed into Artifacts |

### Rule tiers

| Tier | Input | Examples |
|---|---|---|
| **Artifact** | One artifact and its scripts | `eval`, GlideRecord in a loop, `getRowCount`, synchronous GlideAjax, hardcoded sys_ids or credentials |
| **ChangeSet** (architecture) | The whole change | Dependencies missing from the update set, cross-scope access, duplication of out-of-box behavior |
| **Context** | Change + knowledge graph | Table already has many before-query business rules; ACL weakens existing access |

### Rule authoring

- **Script rules** use the **ESLint rule API**, run in-process through `Linter`, with
  ServiceNow globals and script kinds (server, client, portal) as configuration.
- **Simple metadata rules are declarative YAML.** Complex rules are TypeScript modules.
- Every rule has:
  - a stable ID, for example `SN-SEC-001` (v1 IDs carry over);
  - a category: security, performance, upgradability, manageability or user_experience;
  - a default severity: `block`, `warn` or `info`;
  - a description, a remediation text and **specification tests** (code that triggers it
    and code that doesn't).
- Rules ship in **rule packs** (packages). `rules-basic` is the free, built-in pack.

### Findings, gate, waivers

- **One finding format:** rule, severity, category, path, field, line, message, fix,
  evidence (redacted for credential rules). Output as agent text, JSON, or SARIF for CI.
- For updates, only findings the change **introduces** count. Pre-existing findings are
  reported separately.
- **The gate fails** when unwaived `block` findings remain, or when a review required by
  policy is missing.
- **Waivers** in `waivers.yaml` cover one rule and one path glob, with a reason, an
  approver and an expiry of 366 days at most. Expired or malformed waivers waive nothing
  (v1 semantics).
- Governance reaches analyzers through the **`Validator` port**, so premium analysis
  plugs in without changes to the core (ADR-0008).

## Consequences

- The same rules give fast feedback to agents and enforce at PR and promotion.
- Update sets built in the browser can be validated too (new compared with v1).
- The parser in the update-set source must handle every artifact type that contains
  scripts.
- The skills reference rule IDs, and remediation text reaches the agent through findings.

## Alternatives considered

- **Keep the v1 lexer.** Rejected. It can't do scope or data-flow analysis.
- **Rules only in hosted analysis.** Deferred. See ADR-0008.
