# 0003. One use-case registry generates CLI, MCP and hook interfaces

- Status: Accepted (amended by 0012)
- Date: 2026-10-05
- Requirements: ASR-01, ASR-09, ASR-10

## Context

v1 defined every tool twice, in the Python CLI and in the Node Copilot extension and MCP
server, and the two drifted. Several interfaces (CLI, MCP, host hooks, CI) must expose
the same operations with identical behavior.

## Decision

- Each operation is a **use case** registered once in `packages/cli/src/registry/`.
  A use case has:
  - a name and a one-line description written for a model ("what it is for, when to use
    it");
  - a **zod** input schema and a zod output schema;
  - flags: `readOnly`, `destructive`, `requiresDevelopmentInstance`;
  - a handler that calls one application service in `packages/core`.
- The **CLI commands, the MCP tools (input schema, output schema, annotations), the hook
  handlers and the JSON output are generated from the registry.** Nothing is defined
  twice by hand.
- **Interfaces contain no business logic.** They parse input, call the use case and
  format output.
- **Error model.** Expected failures are typed errors (`SnagenticError` subclasses) with
  a stable `code`, a message and a `hint` that names the next action, for example
  `mirror is stale → run: snagentic pull`. Each code maps to one CLI exit code and to one
  MCP error result.
- **Exit codes:**

  | Code | Meaning |
  |---|---|
  | 0 | OK |
  | 1 | Blocking findings |
  | 2 | Usage error |
  | 3 | Precondition not met (stale mirror, unmerged changes, ...) |
  | 4 | Remote error (ServiceNow or network) |
  | 5 | Not permitted (instance kind, mode, license) |

- **Output formats:**
  - `agent`: concise, `file:line`, rule ID, fix and next command;
  - `json`: the output schema;
  - `text`: for humans.

  All list output is bounded, with `--limit` and a cursor.

## Consequences

- The CLI and MCP cannot drift. Adding a use case automatically adds both interfaces.
- The MCP tool budget (ADR-0002) can be checked in CI by counting registry entries marked
  `mcp: true`.
- The registry is the single readable catalog of what the product does (ASR-10).

## Alternatives considered

- **Hand-written CLI and MCP layers.** Rejected. This is what drifted in v1.
- **The MCP server shelling out to the CLI.** Rejected. A second process and a second
  language for no benefit.
