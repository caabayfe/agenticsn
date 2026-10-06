# Architecture decision records

Each significant decision gets one short record. Records are immutable once accepted. To
change a decision, write a new ADR that supersedes or amends the old one, and update the
old one's status line (`Superseded by NNNN` or `Accepted (amended by NNNN)`).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith-hexagonal.md) | Modular monolith with hexagonal architecture and bounded contexts | Accepted |
| [0002](0002-agent-interface-model.md) | Agent interface model: files and CLI first, one small MCP, task-level skills | Accepted (amended by 0011, 0012, 0019) |
| [0003](0003-use-case-registry.md) | One use-case registry generates CLI, MCP and hook interfaces | Accepted (amended by 0012) |
| [0004](0004-deployment-topology.md) | One binary, git as the distribution layer, three operating modes | Accepted (amended by 0011, 0012) |
| [0005](0005-typescript-and-bun.md) | TypeScript compiled to a single binary with Bun | Accepted |
| [0006](0006-governance-model.md) | Governance validates any change source with three rule tiers | Accepted |
| [0007](0007-disk-format-and-hash-contract.md) | Keep the v1 disk format, mirror branch and hash contract | Accepted (amended by 0014, 0015, 0017) |
| [0008](0008-commercial-boundary.md) | Open core with a sealed premium engine behind the `Validator` port | Proposed |
| [0009](0009-engineering-practices.md) | Engineering practices: TDD, strict typing, enforced boundaries | Accepted |
| [0010](0010-v1-scope.md) | v1 scope and explicit exclusions | Accepted (amended by 0011, 0012, 0013) |
| [0011](0011-enforcement-layers.md) | Enforcement layers: what each control stops and who can bypass it | Accepted (amended by 0019) |
| [0012](0012-production-read-only-by-construction.md) | Production access is read-only by construction | Accepted, pending spike (amended by 0013) |
| [0013](0013-v1.0-release-scope.md) | v1.0 release scope | Accepted (amended by 0018) |
| [0014](0014-workspace-layout.md) | Synced data lives in a workspace with a standard layout | Accepted (amended by 0017) |
| [0015](0015-yaml-writing-style.md) | YAML writing style | Accepted |
| [0016](0016-instance-load-and-pagination.md) | Instance load and pagination policy | Accepted |
| [0017](0017-flat-record-layout-and-full-sync.md) | Flat record layout and full sync by default | Accepted |
| [0018](0018-update-sets-read-live.md) | Update sets are read live, and exported from reads | Accepted |
| [0019](0019-engine-served-through-mcp.md) | The engine is served through MCP; the harness only triggers it | Accepted |

Requirements referenced as `ASR-nn` are in
[`../architecture/significant-requirements.md`](../architecture/significant-requirements.md).

## Open questions

These need a decision. Each will become an ADR.

1. **Core license.** Apache-2.0 (maximum community appeal) or FSL (stops competitors
   reselling)? Depends on ADR-0008.
2. **ServiceNow SDK / Fluent.** Add a Fluent source adapter for scoped apps after v1?
3. **Agentic troubleshooting console inside ServiceNow.** Should troubleshooting also be
   offered as a console running in the instance? It has different security properties
   (identity, data residency, platform AI controls). Deferred to a later stage
   (see ADR-0012).

Resolved: *when is a remote MCP worth running?* For production troubleshooting, as the
read gateway (ADR-0012). *Default mirror scope?* Everything, out-of-box included (ADR-0017).

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Requirements: ASR-nn, ...

## Context
What forces are at play, and what problem needs a decision.

## Decision
What we will do, stated plainly.

## Consequences
What becomes easier, what becomes harder, and what we must now do.

## Alternatives considered
Each option and why it was not chosen.
```
