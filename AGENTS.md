# AGENTS.md

Instructions for coding agents working **on snagentic itself**. Read this first, every
session.

## What this is

snagentic lets developers build ServiceNow features with any coding agent, using git.
It has three goals, and every change must serve one of them:

1. **Develop:** mirror instance metadata to git, edit as files, push to development
   update sets.
2. **Audit and troubleshoot:** use the mirrored metadata to explain, search and assess
   an instance.
3. **Guardrails:** validate changes (local, pull request or update set) for architecture,
   performance and security.

This is a clean rebuild of `../snagentic` (v1). v1 is a **reference for algorithms,
fixtures and ServiceNow behavior, not code to copy**. v1 failed through scope creep and
mixed layers; don't repeat that.

**Status:** pre-scaffold. Phase 0 must create the commands below. Until then, they
describe the target.

## Read before changing anything

- `docs/architecture/significant-requirements.md`: the requirements (`ASR-nn`).
- `docs/adr/`: accepted decisions. **Don't contradict an accepted ADR.** If one seems
  wrong, stop and propose a new ADR.
- `docs/adr/0010-v1-scope.md`: what is in and out of scope. **Out-of-scope work needs an
  ADR first.**

## Commands

```bash
bun install                # install dependencies
bun test                   # all tests (no network, no live instance)
bun test <path>            # one file or folder
bun run typecheck          # tsc --noEmit, strict
bun run lint               # biome check
bun run format             # biome format --write
bun run arch               # dependency-cruiser boundary rules
bun run verify             # typecheck + lint + arch + test: run before every commit
bun run build              # compile the snagentic binary for this platform
SNAGENTIC_LIVE_INSTANCE=pdi bun test tests/live   # opt-in, real instance
```

## Repository layout

```
packages/
  core/src/
    kernel/            SysId, TableName, Scope, canonical text + hash, base errors
    metadata/          Artifact, ArtifactType registry, Snapshot, ChangeSet
    sync/              domain/ application/ ports.ts   (pull, integrate, plan, push)
    knowledge/         domain/ application/ ports.ts   (model, graph, search, audit)
    governance/        domain/ application/ ports.ts   (rules, gate, waivers, reports)
    adapters/          servicenow/ git/ fs/ sqlite/ keyring/
  rules-basic/         free rule pack: one folder per rule, with spec tests
  agent-packs/         skills, instructions, hooks, rendered per host
  cli/src/
    registry/          use cases: zod schemas + handler (single source of truth)
    cli/ mcp/ hooks/   generated interfaces, no logic
docs/adr/  docs/architecture/
tests/fixtures/        hash vectors, sample artifacts, recorded HTTP
```

## Architecture rules (enforced by `bun run arch`)

- `domain/` is **pure**. No I/O, `Date.now()`, randomness, `process`, `fetch`, `fs` or
  Bun APIs. Inject a clock or ID source through ports.
- `application/` orchestrates the domain through **ports** declared in that context's
  `ports.ts`.
- `adapters/` implement ports and contain **no business rules**. Bun-specific APIs are
  allowed only here.
- `packages/cli` contains **no business logic**. Every operation is a use case in
  `registry/`, and the CLI, MCP tools and hooks are generated from it. Never hand-write
  an MCP tool or CLI command.
- Contexts use `kernel` and `metadata` directly. Otherwise they talk through application
  services, never each other's internals.

## How to work (TDD, always)

1. Find the requirement (goal, ASR or ADR) the change serves. If none exists, stop and
   ask.
2. Write a **failing test** named as behavior, for example
   `it("refuses to push to a production instance")`.
3. Write the minimum code to pass it. Then refactor while staying green.
4. Run `bun run verify`. Commit only when it passes.

Choosing the test:

| Code | Test with |
|---|---|
| Domain logic | Unit tests; `fast-check` for properties (round-trips, hashing, diffs) |
| Use cases | In-memory fake ports in `packages/core/test/fakes/` |
| Adapters | The shared contract suite for that port; HTTP via `msw`; git against temporary repositories |
| Disk format, agent output, SARIF | Golden files |
| Never in default tests | Real network, real credentials, live instances |

## Code conventions

- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
  **No `any`**, no `as` casts to escape the type system, no `!` non-null assertions in
  production code.
- Identifiers are **branded types** created by validating factories
  (`SysId.parse(value)`). Domain data is `readonly`; prefer discriminated unions to flags.
- Functions and plain data by default. Classes only for adapters and errors.
- Expected failures throw `SnagenticError` subclasses with a stable `code` and a `hint`
  naming the next action. Never throw bare strings or `Error` for expected conditions.
- **Naming:**
  - files `kebab-case.ts`;
  - types `PascalCase`;
  - functions and variables `camelCase`;
  - constants `UPPER_SNAKE_CASE`;
  - named exports only, no default exports.
- Each package exposes its public API through `src/index.ts`. Don't import another
  package's internals.
- Keep files under ~300 lines and functions under ~40. Past that, split.
- Comments explain **why**, not what. No commented-out code.

## Adding things

- **A use case:** a zod input and output schema plus a handler in
  `packages/cli/src/registry/`, calling one application service. Set `readOnly`,
  `destructive` and `requiresDevelopmentInstance` correctly. Mark `mcp: true` only if it
  earns a place in the **12-tool MCP budget** (ADR-0002).
- **A rule:** a folder in `packages/rules-basic/` with:
  - metadata: ID, category, severity, description, remediation;
  - the implementation (ESLint rule API for scripts, YAML or TypeScript for metadata);
  - spec tests with at least one triggering and one passing sample.

  Never reuse or renumber a rule ID.
- **An artifact type:** register it in the `ArtifactType` registry (script fields,
  language, file extensions). No per-class special cases elsewhere.
- **A dependency:** justify it in the commit message. Prefer the standard library. No
  native add-ons beyond those named in ADR-0005.

## Safety invariants (never weaken, always tested)

- Only instances of kind `development` can be written. For `test` and `production`,
  write use cases are **not registered at all**: they are absent, not just refused
  (ADR-0012).
- Before calling a test or production instance, verify the credential is read-only
  (`snc_read_only`, no write roles). If it isn't, refuse to operate (ADR-0012).
- Never add production "reads" that write: debug properties, background scripts, job,
  ATF or flow execution, cache flushes, impersonation, scripted REST calls.
- Skills and instructions are guidance, never enforcement. Every guarantee must be
  enforced in code, credentials, git or CI (ADR-0011).
- A push requires a plan id, a passing gate and an unchanged remote base hash.
- Credentials live only in the OS keychain or environment variables. Never in files,
  logs, errors, fixtures or commits.
- Password fields, secret-like properties and business records are redacted or
  quarantined **before** anything is written to disk.
- Mirror branch commits use git plumbing. Never touch the user's working tree or index.
- Serialization is deterministic and matches `tests/fixtures/hash-vectors.json` byte
  for byte.

## Don't

- Add features, MCP tools, skills or commands outside `docs/adr/0010-v1-scope.md`
  without an ADR.
- Put logic in `packages/cli`, or I/O in `domain/`.
- Copy v1 code wholesale. Port behavior test-first.
- Weaken a test, a boundary rule or a budget to make something pass. Fix the cause or
  raise it.
- Mark work done while `bun run verify` fails, or claim something was verified that
  wasn't run.

## Commits

Conventional prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `build:`, `ci:`,
`chore:`, with a scope where useful, for example `feat(sync): ...`. One logical change
per commit. Reference the ADR when a commit implements one.
