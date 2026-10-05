# 0001. Modular monolith with hexagonal architecture and bounded contexts

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-10, ASR-11, ASR-14

## Context

snagentic v1 (`../snagentic`) proved the core ideas, but its structure made it hard to
change:

- About 27k lines of Python and 3k of JavaScript, 77 MCP tools, and subsystems far beyond
  the three product goals (customer-hosted service, approvals, jobs, estate, upgrade,
  pipeline, workflow bridges).
- God objects with layers mixed together. `InstanceSync` is about 1,400 lines with nested
  closures that interleave HTTP, git, filesystem, policy and state.
- Three separate knowledge paths (`index`, `impact`, `analysis_index`) with different
  reference extraction and different guarantees.
- Tool definitions duplicated across Python and Node, which drifted apart.

## Decision

Build one codebase as a **modular monolith** organized by **bounded contexts**, with
**hexagonal (ports and adapters)** layering inside each context.

### Bounded contexts

| Context | Responsibility | Goal |
|---|---|---|
| `kernel` | Shared kernel: `SysId`, `TableName`, `Scope`, canonical text and hashing, base errors | all |
| `metadata` | The central model: `Artifact`, `ArtifactType` registry, `Snapshot`, `ChangeSet` | all |
| `sync` | Pull, integrate, plan and push to update sets | G1 |
| `knowledge` | Table model, reference graph, search, impact, audit | G2 |
| `governance` | Rules, policy, waivers, gate, reports | G3 |
| `troubleshooting` | Live read-only investigation (after v1) | G2 |

### Ubiquitous language

- **Instance**: a profile with a `kind` (development, test or production). The kind sets
  the write policy.
- **Artifact**: one ServiceNow metadata record. It has an identity (sys_id, class,
  scope), normalized fields, script bodies and read-only children.
- **ArtifactType**: the registry entry for a class. It lists the script fields, their
  language (server, client, portal) and the files they are written to.
- **Snapshot**: an immutable set of artifacts, which is a commit on the mirror branch.
- **Workspace**: the user's working tree.
- **ChangeSet**: the operations that turn a Snapshot into a target state. Pushed as one
  **UpdateSet** per application scope.
- **Rule, Finding, Policy, Waiver, Verdict**: the governance vocabulary (ADR-0006).

### Layers and dependency rule

```
interfaces  →  application (use cases)  →  domain
                     ↓
                   ports (interfaces)  ←  adapters (servicenow, git, fs, sqlite, keyring)
```

- `domain` is pure: no I/O, no clock, no randomness, and no imports from adapters or
  interfaces.
- `application` orchestrates domain logic through **ports**. Each context declares the
  ports it needs.
- `adapters` implement ports. They hold no business rules.
- `interfaces` (CLI, MCP, hooks) translate requests into use cases. They hold no logic
  (ADR-0003).
- Contexts depend on `kernel` and `metadata`. Otherwise they talk through application
  services, never through each other's internals.
- **dependency-cruiser enforces these rules in CI** (ADR-0009).

## Consequences

- The domain can be tested without HTTP, git or the filesystem, so TDD stays fast.
- Each piece of logic has exactly one home, which removes the duplicate paths found in v1.
- Premium analysis can be plugged in behind a port (ADR-0008).
- More files and explicit interfaces than a script-style codebase. This is accepted.

## Alternatives considered

- **Refactor v1 in place.** Rejected. Untangling the god objects costs more than porting
  algorithms and fixtures into a clean structure.
- **Microservices, or separate MCP products per goal.** Rejected. That duplicates models,
  policy and state, turns consistency into a distributed-systems problem, and adds
  operations work with no benefit at this scale.
