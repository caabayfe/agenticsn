# Architecture decision records

Each significant decision gets one short record. Records are immutable once accepted. To
change a decision, write a new ADR that supersedes or amends the old one, and update the
old one's status line (`Superseded by NNNN` or `Accepted (amended by NNNN)`).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith-hexagonal.md) | Modular monolith with hexagonal architecture and bounded contexts | Accepted |
| [0002](0002-agent-interface-model.md) | Agent interface model: files and CLI first, one small MCP, task-level skills | Accepted (amended by 0011, 0012, 0019, 0026) |
| [0003](0003-use-case-registry.md) | One use-case registry generates CLI, MCP and hook interfaces | Accepted (amended by 0012) |
| [0004](0004-deployment-topology.md) | One binary, git as the distribution layer, three operating modes | Accepted (amended by 0011, 0012, 0022) |
| [0005](0005-typescript-and-bun.md) | TypeScript compiled to a single binary with Bun | Accepted |
| [0006](0006-governance-model.md) | Governance validates any change source with three rule tiers | Accepted |
| [0007](0007-disk-format-and-hash-contract.md) | Keep the v1 disk format, mirror branch and hash contract | Accepted (amended by 0014, 0015, 0017) |
| [0008](0008-commercial-boundary.md) | Open core with a sealed premium engine behind the `Validator` port | Proposed |
| [0009](0009-engineering-practices.md) | Engineering practices: TDD, strict typing, enforced boundaries | Accepted |
| [0010](0010-v1-scope.md) | v1 scope and explicit exclusions | Accepted (amended by 0011, 0012, 0013, 0024, 0026) |
| [0011](0011-enforcement-layers.md) | Enforcement layers: what each control stops and who can bypass it | Accepted (amended by 0019) |
| [0012](0012-production-read-only-by-construction.md) | Production access is read-only by construction | Accepted, pending spike (amended by 0013, 0021; by 0038) |
| [0013](0013-v1.0-release-scope.md) | v1.0 release scope | Accepted (amended by 0018) |
| [0014](0014-workspace-layout.md) | Synced data lives in a workspace with a standard layout | Accepted (amended by 0017) |
| [0015](0015-yaml-writing-style.md) | YAML writing style | Accepted |
| [0016](0016-instance-load-and-pagination.md) | Instance load and pagination policy | Accepted |
| [0017](0017-flat-record-layout-and-full-sync.md) | Flat record layout and full sync by default | Accepted |
| [0018](0018-update-sets-read-live.md) | Update sets are read live, and exported from reads | Accepted |
| [0019](0019-engine-served-through-mcp.md) | The engine is served through MCP; the harness only triggers it | Accepted |
| [0020](0020-instance-trust-outside-the-repository.md) | Instance kind and address are trusted from outside the repository | Accepted (amended by 0021) |
| [0021](0021-oauth-client-credentials.md) | OAuth client credentials, with checks bound to the authenticated session | Accepted |
| [0022](0022-pull-requests-through-the-platform-cli.md) | Pull requests are linked and opened through the git platform's CLI | Accepted |
| [0023](0023-upgrade-and-update-notice.md) | `snagentic upgrade` and an update notice, with no silent self-update | Accepted |
| [0024](0024-elevated-session-for-acl-writes.md) | ACLs are written through an elevated browser session | Superseded by 0031 |
| [0025](0025-choices-and-layouts-as-editable-child-rows.md) | Choice lists, form and list layouts, and applications are delivered from files | Superseded by 0031 (authoring) |
| [0026](0026-accelerators-as-content-packs.md) | Accelerators are versioned content packs, installed through the existing flow | Accepted (amended 2026-10-14; by 0031; by 0038) |
| [0027](0027-domains-are-record-attributes-written-explicitly.md) | A record's domain is an attribute, written explicitly on push | Accepted |
| [0028](0028-flows-authored-in-fluent-delivered-by-push.md) | Flows are authored in Fluent and delivered by push, published into the batch | Accepted (amended 2026-10-14) |
| [0029](0029-list-layouts-delivered-whole-through-fluent-load.md) | List layouts are delivered whole, through the Fluent load route | Superseded by 0031 (findings kept) |
| [0030](0030-what-the-platform-does-not-record-is-loaded.md) | What the platform does not record is loaded as the update it records | Superseded by 0031 (findings kept) |
| [0031](0031-changes-are-authored-in-fluent.md) | Changes are authored in Fluent; the mirror is read-only | Accepted |
| [0032](0032-the-sdk-runs-behind-snagentics-connector.md) | The SDK runs in-process, behind snagentic's connector | Accepted |
| [0033](0033-plans-compare-the-build-with-the-instance.md) | Plans compare the build with the instance; owned records have a base | Accepted |
| [0034](0034-the-mirror-keeps-typed-property-values-and-names-what-it-leaves-out.md) | The mirror keeps typed property values and names what it leaves out | Accepted |
| [0035](0035-pulls-scan-what-they-write-for-secrets.md) | Pulls scan what they write for secrets | Proposed |
| [0036](0036-verified-documentation-site.md) | Verified documentation: pages anchored to the mirror, published as a static site | Accepted |
| [0037](0037-an-employee-guide-and-an-it-guide-from-one-source.md) | An employee guide and an IT guide, published from one source | Accepted |
| [0038](0038-accelerator-install-and-platform-components.md) | Accelerators install by plan; platform components install automatically on every instance | Accepted |
| [0039](0039-a-change-shows-what-it-does-to-the-documentation.md) | A change shows what it does to the documentation, sentence by sentence | Accepted |
| [0040](0040-every-feature-of-a-process-has-a-decision.md) | Every feature of a process is found and has a decision | Accepted |
| [0041](0041-open-questions-are-records-with-an-answer.md) | Open questions are records, each with someone to ask and an answer | Accepted |

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
