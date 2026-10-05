# 0010. v1 scope and explicit exclusions

- Status: Accepted (amended by 0011, 0012)
- Date: 2026-10-05
- Requirements: all

## Context

Scope creep was the main failure of snagentic v1. Each feature was reasonable on its own;
together they buried the core product.

## Decision

v1 is built in phases. Each phase is usable on its own and ends with a working binary.

| Phase | Delivers | Goal |
|---|---|---|
| 0 | Skeleton, toolchain, boundary rules, `kernel` and `metadata`, hash-vector parity, ADR-0005 spikes | — |
| 1 | **Pull and integrate**: read-only mirror and table model | G1, G2 |
| 2 | **Governance**: `check`, `validate`, rules-basic, agent packs, host hooks, pre-commit | G3 |
| 3 | **Plan and push** to development update sets with the gate | G1 |
| 4 | **Knowledge and audit**: reference graph, search, impact, audit reports | G2 |
| 5 | **Update-set validation** before promotion, MCP server, CI templates | G3 |
| 6 | Troubleshooting: live read-only investigation | G2 |

**Out of scope for v1.** Each item needs its own ADR before any work starts:

- the customer-hosted service, approval store and durable jobs (replaced by git platform
  review, ADR-0004);
- persistent feature workflows and workflow bridges;
- estate, drift and release-evidence features;
- upgrade intelligence;
- the resumable advisory index and analysis cache;
- diagnostic memory;
- Playwright UI recipes;
- the proprietary Copilot extension (MCP covers Copilot);
- multiple MCP servers.

## Consequences

- Every new feature request is checked against this list and the three goals.
- Saying no is the default. Adding to scope requires an ADR.
