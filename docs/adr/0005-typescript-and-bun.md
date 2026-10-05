# 0005. TypeScript compiled to a single binary with Bun

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-04, ASR-05, ASR-10, ASR-11

## Context

Criteria, in order of weight:

1. Quality of JavaScript analysis (the core of G3).
2. Reviewability by the product owner and ServiceNow developers.
3. Community contribution: ServiceNow developers write JavaScript.
4. Single-file installation without dependency problems.
5. Startup latency (hooks run after every edit) and analysis performance.
6. A mature MCP SDK.

Code protection is handled separately (ADR-0008) and was not a criterion here.

## Decision

Use **TypeScript (strict, ES modules)** on **Bun**:
- `bun build --compile` produces one executable per platform, cross-compiled from one
  machine;
- `bun test` runs the tests;
- Bun is the package manager.

Key libraries:

| Area | Choice |
|---|---|
| Schemas | `zod` |
| MCP | `@modelcontextprotocol/sdk` |
| CLI | `commander`, generated from the registry (ADR-0003) |
| Script analysis | ESLint `Linter` API with `espree` and `eslint-scope` |
| YAML | `yaml` (eemeli) with our own canonical output |
| Search index | `bun:sqlite` (FTS5) |
| Credentials | `@napi-rs/keyring` |
| Git | the `git` CLI |
| HTTP | native `fetch` plus a retry and paging layer |
| Lint and format | Biome |
| Architecture rules | dependency-cruiser |
| Property tests | fast-check |
| HTTP fakes | msw |

Bun-specific APIs (such as `bun:sqlite`) are used only inside adapters, so switching to
Node or Deno later is contained.

## Consequences

- **Analysis quality:** the JavaScript ecosystem has the best JavaScript tooling.
  Community rules use an API ServiceNow developers can learn.
- **Distribution:** single binary of about 60–100 MB; the only prerequisite is `git`; no
  Python packaging problems.
- **Startup:** about 20–40 ms, compared with 150–400 ms for Python with its imports.
- **Fit with ServiceNow:** the ServiceNow SDK and Fluent are TypeScript, so a future
  Fluent adapter can reuse their packages.
- **Risks:**
  - Bun is younger than Node, and its Windows support is the newest part.
  - The native keychain add-on must work inside the compiled binary.
  - JavaScript code is readable (handled in ADR-0008).

## Validation spikes (must pass before phase 1)

1. **Single binary.**
   - **Check:** the compiled binary, including the keyring add-on and FTS5, runs on
     macOS arm64/x64, Windows x64 and Linux x64.
   - **If it fails:** use Node single-executable apps, or the OS command-line credential
     tools.
2. **Real scripts.**
   - **Check:** espree parses a corpus of real ServiceNow scripts (ES5 and ES2021,
     Rhino-era quirks) with a measured failure rate.
   - **If it fails:** add a tolerant fallback.
3. **Hash parity.** See ADR-0007.
4. **Hook latency.**
   - **Check:** `check --changed` on one file runs in under 300 ms end to end.
   - **If it fails:** route hook checks through the warm MCP process.

## Alternatives considered

- **Python.** Rejected. No built-in single binary; one build per OS; PyInstaller
  antivirus flags and temp-folder unpacking; slow startup; JavaScript parsing only via
  tree-sitter.
- **Go.** Rejected. Best distribution, but weak pure-Go JavaScript parsers, and a
  language the owner and community don't use.
- **Rust.** Rejected for the core. Best protection and the oxc parser, but slower
  development and a barrier to community contribution. Kept as an option for the sealed
  premium engine (ADR-0008).
