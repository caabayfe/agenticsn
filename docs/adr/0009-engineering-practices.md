# 0009. Engineering practices: TDD, strict typing, enforced boundaries

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-10, ASR-13

## Context

v1 grew by accepting changes quickly. Structure decayed even with high coverage. The
owner validates architecture and behavior rather than reading every line, so the process
itself must protect quality.

## Decision

- **Test-driven development.** Write a failing test, make it pass, refactor. No
  production code without a test that required it.
- **Test pyramid:**

  | Level | Scope | Tools |
  |---|---|---|
  | Unit | Pure domain, the majority | `bun test`, fast-check for properties (serialization round-trips, hashing, diffing) |
  | Application | Use cases with in-memory fake ports | `bun test` |
  | Adapter contract | Each adapter against a shared contract suite; ServiceNow via an in-memory fake and recorded HTTP | msw |
  | Golden | Disk format, agent output, SARIF | Snapshot files |
  | End-to-end | The compiled binary against fixtures | `bun test` |
  | Live | Opt-in only, against a PDI | `SNAGENTIC_LIVE_INSTANCE` |

- **Tests are specifications.** Names read as behavior:
  `"push refuses a production instance"`, not `"test push 3"`.
- **Strict TypeScript.** `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; no `any`; no non-null assertions in production code.
- **Domain modeling.**
  - Branded types for identifiers (`SysId`, `TableName`, `Scope`).
  - Readonly data, discriminated unions, factory functions that check invariants.
  - Classes only for adapters and errors.
- **Enforced boundaries.** dependency-cruiser rules from ADR-0001 run in CI. A violation
  fails the build.
- **Formatting and linting.** Biome. One tool, no style debates.
- **Small units.** Files over about 300 lines or functions over about 40 lines are a
  refactoring signal.
- **Budgets checked in CI:**
  - MCP tools ≤ 12;
  - coverage ≥ 90% for `domain` and `application`;
  - hook latency target from ASR-04.
- **Commits.** Conventional prefixes (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`,
  `build:`, `ci:`, `chore:`). One logical change per commit.
- **Decisions.** Anything that affects an ASR, a public interface, the disk format or
  the scope needs an ADR first.

## Consequences

- Slower first commits, faster and safer change later.
- The owner can review through ADRs, test names, rule specifications and CLI behavior.
