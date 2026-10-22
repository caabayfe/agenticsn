# Code audit: quality, maintainability, security, testing and practices

- Date: 2026-10-21
- Commit audited: `a50751c` (`main`, release 1.6.0 line; CLI package version 2.5.0)
- Method: ran the repository's own gates, static probes (grep) over `packages/*/src`, `bun audit`,
  and a read of the CI workflows, the installer/upgrade path and a sample of adapters. This is a
  point-in-time review, not a line-by-line read of ~36,000 lines of product code.
- Purpose: a base for an improvement plan. Each finding has an ID (`A-nn`), evidence, impact and a
  suggested action. Section 8 turns them into a prioritised plan.

## 1. Summary

The codebase is in **good health**, and unusually disciplined for its size. The conventions in
`AGENTS.md` are mostly enforced by tooling rather than by good intentions, and the main gaps sit
**around** the code (supply chain, repository hygiene, test-environment sensitivity) rather than
inside it.

| Area | Rating | One-line reason |
|---|---|---|
| Architecture | Strong | Hexagonal boundaries enforced by dependency-cruiser; 0 violations in 720 modules |
| Code quality | Strong, with drift | Strict TS, no `any`, no `!`, no TODO/console; but type casts exceed the stated rule |
| Testing | Strong, environment-sensitive | 1,836 tests, ~98.8 % line coverage, 90 % gate; 2 local failures, media tests depend on tools |
| Security (own code) | Good | Read-only-by-construction, SHA-256 verified upgrades, parameterised SQL, traversal guard |
| Security (supply chain) | **Needs action** | 32 known vulnerabilities (2 critical) via the pinned ServiceNow SDK; no automated updates |
| Maintainability | Good | 300-line cap, 40 ADRs; risks are ADR drift and embedded web assets |
| Repository practices | Gaps | No LICENSE, SECURITY.md, CONTRIBUTING.md, CODEOWNERS or Dependabot |

## 2. Snapshot (measured)

| Metric | Value |
|---|---|
| Product code | core 279 files / 23,664 lines; cli 146 / 12,115; rules-basic 7 / 661; agent-packs 13 / 527 |
| Tracked files / commits | 1,147 / 470 |
| Tests | 1,836 run across 233 files (16 skipped); roughly 90 to 170 s locally |
| Coverage (`bun test --coverage`) | 98.78 % functions, 98.81 % lines; gate `coverageThreshold = 0.9` |
| `bun run typecheck` | Pass (after `bun install`) |
| `bun run arch` | Pass: 720 modules, no violations |
| `bun run size` | Pass: 445 files, largest 296 lines (limit 300) |
| `bun run lint` | Pass with **1 warning** |
| `bun test` | **2 failures** locally (see A-05) |
| `bun audit` | **32 vulnerabilities: 2 critical, 11 high, 14 moderate, 5 low** |
| Largest product files | `advice/domain/rules.ts` 296, `git-mirror.ts` 295, `plan-units.ts` 293, `servicenow-client.ts` 293 |

Static probes over product code: `any` 0; `@ts-ignore`/`@ts-expect-error` 0; `biome-ignore` 1
(justified, VS Code variable syntax); non-null `!` 0; `TODO/FIXME/HACK` 0; `console.*` 0;
`sysparm_offset` 0; `eval`/`new Function` 0 (only in rule text); `rejectUnauthorized`/TLS
overrides 0.

## 3. What is working well (keep doing)

1. **Boundaries are enforced, not documented.** `bun run arch` plus
   `tests/architecture/boundaries.test.ts` prove each dependency rule fires against fixtures.
2. **The quality gates test themselves.** `tests/quality/code-gates.test.ts` lints sample code in
   an isolated copy to show the Biome limits (function length 50, cognitive complexity 15) really
   fail. Gates that cannot silently rot are rare.
3. **Strict compiler settings:** `strict`, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax`.
4. **Decision traceability:** 40 ADRs, amendments tracked in the ADR index, an MCP tool budget
   enforced by a test (`MCP_TOOL_BUDGET = 13`, `registry.test.ts:43`).
5. **Safe release pipeline basics:** least-privilege `permissions`, `--frozen-lockfile`, pinned
   Bun (1.4.2), checksums, build-provenance attestation, tag/version/changelog consistency check.
6. **Safe defaults in adapters:** the preview server binds `127.0.0.1`, serves GET/HEAD only and
   rejects paths leaving the root (`static-site-server.ts:24-48`); SQL values are bound
   parameters (`sqlite-knowledge-store.ts:124-144`); child processes get `GIT_TERMINAL_PROMPT=0`
   and `GH_PROMPT_DISABLED=1`; no sync use of `sysparm_offset`.
7. **Credentials design:** keychain or environment only, a layered store, secret scanning on pull
   (ADR-0035) and redaction before write.

## 4. Findings: security

### A-01 Known vulnerabilities in transitive dependencies (High)

`bun audit` reports 32 advisories (2 critical, 11 high). All traced packages come in through
`@servicenow/sdk`, `@servicenow/sdk-api` and `@servicenow/sdk-build-core`, which are pinned
**exactly** to `4.13.6` in `packages/cli/package.json`:

- critical: `handlebars@4.7.9` (JavaScript injection, two advisories);
- high: `undici@7.29.0` (TLS validation bypass via `BalancedPool`, WebSocket DoS), `fastify`,
  `@fastify/static`, `braces`, `joi`, `js-yaml`.

Impact depends on how the SDK uses them, and the SDK is embedded in the compiled binary
(ADR-0032), so a fix cannot come from the user's machine. I did **not** verify reachability.
Action: (1) triage each advisory for reachability in snagentic's usage (build-only, local, no
untrusted templates), recording the result in an ADR or a doc; (2) check for a newer SDK release;
(3) use `overrides` for packages with a compatible patched version, and test the Fluent build
afterwards; (4) add the audit to CI (A-02).

### A-02 No automated dependency or vulnerability monitoring (High)

No `.github/dependabot.yml`, no CodeQL, no `bun audit` step in `verify.yml` or `release.yml`.
A release can ship with known critical advisories without anyone being told. Action: Dependabot
for `bun`/`npm` and `github-actions`; a scheduled audit workflow that reports (not blocks) and
an allowlist file for accepted advisories with an expiry date; optionally CodeQL for TypeScript.

### A-03 GitHub Actions pinned by tag, not commit SHA (Medium)

`actions/checkout@v5`, `oven-sh/setup-bun@v2`, `actions/upload-artifact@v4`,
`actions/download-artifact@v4`, `actions/attest-build-provenance@v2`. A moved tag runs new code
inside the release job, which holds `contents: write`, `id-token` and `attestations: write`.
Action: pin the `publish` job's actions to full SHAs (Dependabot keeps them current).

### A-04 Upgrade and install trust model (Medium)

`SHA256SUMS` is downloaded from the same release as the binary
(`github-releases.ts:56-62`, `install.sh:36-46`), so it detects corruption but not a compromised
release. The build-provenance attestation is produced in CI but **never verified** by
`install.sh` or `snagentic upgrade`. `curl | sh` is the documented install path. Action: verify
the attestation when `gh` is available (`gh attestation verify`) and document it as the
recommended path; consider signing `SHA256SUMS` (cosign or minisign) with a key whose public half
ships inside the binary. This is a design choice: write an ADR (it touches ADR-0023).

### A-12 Full environment passed to child processes (Low)

`{ ...process.env }` is forwarded to `git`, `gh`, the Fluent SDK and others
(`run-git.ts:13,42`, `git-mirror.ts:287`, `fast-import.ts:33`, `gh-pull-requests.ts:89`,
`git-pack-workspace.ts:32`). When credentials come from environment variables
(`EnvironmentCredentialStore(process.env)`, `main.ts:89`), those secrets reach every child.
Action: a small `childEnvironment()` helper that allowlists what each tool needs and drops
snagentic credential variables. `sdk-runtime.ts:160` also mutates `process.env["NO_TELEMETRY"]`
globally; prefer passing it to the child or scoping it.

### A-13 Missing security and project policy files (Low, process)

No `SECURITY.md` (how to report), `LICENSE` (ADR-0008 describes an open-core model but is still
"Proposed", and nothing states the terms of the code), `CONTRIBUTING.md` or `CODEOWNERS`. For a
tool that holds ServiceNow credentials and writes to instances, the reporting channel matters.

## 5. Findings: testing

### A-05 Two tests fail on a developer machine; test environment is not hermetic (Medium)

`GitDeliveryWorkspace ... publishes the branch to origin and sets it as upstream` and
`... publishes to the branch's own remote when it has one` fail with
`fatal: cannot use bare repository ... (safe.bareRepository is 'explicit')`. The tests create a
bare remote in a temp directory and then run `git branch --list` against it. They depend on the
developer's global git configuration. Action: make the test (or the adapter) pass
`-c safe.bareRepository=all` for those temp repos, or set `GIT_CONFIG_GLOBAL=/dev/null` and
`GIT_CONFIG_NOSYSTEM=1` in the shared test helper so every git-based test is hermetic. Check
whether the production adapter needs the same flag for users with `explicit` set (the
`GitDeliveryWorkspace` push path may be a real bug, not only a test problem).

### A-06 Coverage depends on tools the machine may lack (Medium)

`media-adapters.test.ts` and `video-adapters.test.ts` use `skipIf` for ffmpeg, `say`, Piper and
Chrome. Without them, line coverage of `chrome-video-renderer.ts` is 17 %, `ffmpeg-codec.ts`
15 %, `devtools-client.ts` 31 %, `voices.ts` 59 %, `fs-audio-assets.ts` 37 %. CI installs ffmpeg
and uses the runner's Chrome, so the gate passes there, but `bun run verify` is therefore not
reproducible locally, and the 98.8 % figure hides a thin spot. Action: (1) unit-test the argument
building and parsing of these adapters against a fake `run-tool`; (2) keep the real-tool tests as
a separate, clearly named tier; (3) state the prerequisites in `AGENTS.md` next to `verify`.

### A-07 Nested or repeated test summaries and run time (Low)

One `bun test --coverage` run printed two summary blocks (1,683 pass / 27 fail, then 1,818 pass /
2 fail). I did not investigate; most likely some tests spawn `bun test` or the CLI as
subprocesses. Worth understanding because failures inside nested runs can be missed by a reader
and can double test time (about 170 s). Action: find the source, and make nested runs report
through the parent or move them out of `bun test`.

### A-08 What the default suite does not cover (Info)

- `tests/live` is opt-in and not in CI: nothing automatically proves behaviour against a real
  instance after a ServiceNow release or an SDK bump. Consider a scheduled (weekly) manual
  workflow with a PDI secret, read-only first.
- Windows is built in CI but `bun run verify` only runs on Ubuntu; path handling, line endings
  (`.gitattributes` exists) and file locking are untested on Windows and macOS.
- Property tests (`fast-check`) exist as a devDependency; check they cover hashing, canonical
  text and diffs as `AGENTS.md` requires. I did not count them.

## 6. Findings: quality and maintainability

### A-09 Type-cast rule is stated as absolute but is not enforced (Medium)

`AGENTS.md`: "no `as` casts to escape the type system". There are dozens of `as` sites in
product code, a rough grep (some false positives) finds about 50 real casts. Examples:

- unvalidated persisted state: `json-sync-state-store.ts:52` (`JSON.parse(...) as T`),
  `json-install-journal.ts:19`, `sqlite-knowledge-store.ts:66,108`;
- remote data: `servicenow-client.ts:116,124,136,160` (`result as Row[]`, `as StatsResult`),
  `cicd-plugin-activator.ts:36`, `server-cost.ts:33`;
- logic: `run-instance-checks.ts:165` (`user as Check`), `concurrently.ts:10` (`items[next] as T`),
  `scope-name.ts:14`, and several `as ESTree.Node` in `rules-basic`.

The riskiest are the ones reading **files on disk or HTTP responses** without validation: a
corrupted or older-version state file fails later and far from the cause. Zod is already a
dependency. Action: parse state files and responses with zod schemas (or small guards) at the
adapter edge; enforce the rule with a Biome/ESLint rule (`noAssertions`-style) and an allowlist
of justified exceptions with a comment, as is done for `biome-ignore`.

### A-10 Web assets embedded as strings inside domain code (Low to Medium)

`documentation/domain/site-layout.ts`, `site-style.ts` and `site-menu-script.ts` hold HTML, CSS
and minified JavaScript as TypeScript strings. They are not linted, formatted or type-checked,
are hard to review in diffs, and contain 6 empty `catch` blocks (acceptable for `localStorage`
guards, but invisible to Biome). They also use `postMessage(m,'*')` (`site-layout.ts:49`), fine
for a local static site but worth narrowing to the page origin. Action: keep assets as real
`.css`/`.js`/`.html` files imported as text at build time, so the toolchain covers them.

### A-11 Scope breadth, notably the documentation and media area (Medium, strategic)

`AGENTS.md` names scope creep as the reason v1 failed. The product now includes an HTML
documentation site, audio/video narration with ffmpeg, Chrome DevTools and Piper voices
(ADR-0036 to 0040), an accelerator content-pack system (ADR-0026, 0038), and an embedded
ServiceNow SDK with build patches (`scripts/build-patches.ts`, ADR-0032). Each has an ADR and is
well tested, which is to the team's credit, but together they carry the largest maintenance cost
(external tool prerequisites, an exactly pinned SDK, platform-specific binaries). Action: a
quarterly scope review against goals 1 to 3 in `AGENTS.md`: which of these are used, and could
media rendering become an optional plugin outside the core binary?

### A-14 Hard 300-line cap invites splitting by line count (Low)

Many files sit at 250 to 296 lines (`rules.ts` 296, `git-mirror.ts` 295, `plan-units.ts` 293,
`servicenow-client.ts` 293, `incremental-records.ts` 280, `verify-records.ts` 278). That suggests
files are trimmed to fit the gate, which `AGENTS.md` itself warns against ("split by
responsibility, not by line count"). Not a defect now; watch for artificial splits and review
these files at the next functional change. `core/src/index.ts` (258 lines) is a hand-kept
barrel: a merge-conflict hotspot and easy to leave stale.

### A-15 ADR and documentation drift (Low)

- ADR index lists 0012 as "Accepted, pending spike" and 0008 as "Proposed" while other ADRs build
  on them; confirm and update the status.
- ADR-0013 (v1.0 release scope) and `AGENTS.md` "Status" paragraph are historical; the latter
  grows by accretion. Keep status in one place (`CHANGELOG.md` or the plan) and link to it.
- `CHANGELOG.md` is 718 lines in one file; fine, but consider keeping only the last major lines
  inline.
- The 12-tool MCP wording remains in `AGENTS.md` and ADR-0002 prose, while the real budget is 13
  after ADR-0026. Update the sentence to avoid confusing new contributors.

### A-16 Lint warning left in `verify` output (Low)

`bun run lint` ends with one warning: an unused `arg` in a callback in a spike script
(`tools/spikes/s18-*`, `.filter((arg, index) => ...)`, Biome suggests `_arg`). Fix it, then
consider making warnings fail the gate (`biome check --error-on-warnings`) so the count stays 0.

### A-17 Repository hygiene (Low)

- `tools/spikes/` (about 620 KB, with its own `bun.lock` and seed projects) and `specs/`
  (440 KB) live in the main tree. Spikes outlive their purpose; archive them once their ADR is
  accepted, or move to a separate repository or tag.
- `dist/` is 62 MB on disk (git-ignored, fine) but builds from the working tree are not
  reproducible between runs on macOS (the keychain prompt in `AGENTS.md` shows this). Consider
  reproducible-build settings to help verify release binaries.
- `tests/fixtures/hash-vectors-extended.json` is 2.1 MB: fine, but keep fixtures from growing
  unbounded.
- The `typescript-7-readiness.yml` workflow is a good idea; make sure someone owns watching it.

## 7. Not assessed (be aware)

I did not review: runtime behaviour against a live instance; performance and ServiceNow load
beyond checking for `sysparm_offset`; correctness of individual governance rules; depth of MCP
and CLI input validation (zod schemas per use case); keychain adapter internals; threat modelling
of the Fluent SDK execution inside the binary (ADR-0032); the generated documentation site
content; logging and telemetry (no `console` use found, but the logging design was not read).
These are good candidates for a second, focused pass.

## 8. Improvement plan (proposed)

Effort: S under 1 day, M 1 to 3 days, L over 3 days.

### Now (next 1 to 2 weeks)

| # | Action | Findings | Effort |
|---|---|---|---|
| 1 | Triage the 2 critical and 11 high advisories for reachability; try newer SDK or `overrides`; record the decision | A-01 | M |
| 2 | Add Dependabot (packages and actions) and a scheduled `bun audit` report workflow | A-02 | S |
| 3 | Make git-based tests hermetic (`GIT_CONFIG_GLOBAL`, `safe.bareRepository`) and check the production push path | A-05 | S |
| 4 | Pin release-job actions by SHA | A-03 | S |
| 5 | Add `SECURITY.md`, `LICENSE` (decide terms), `CONTRIBUTING.md`, `CODEOWNERS` | A-13 | S |
| 6 | Fix the lint warning; fail CI on warnings | A-16 | S |

### Next (1 to 2 months)

| # | Action | Findings | Effort |
|---|---|---|---|
| 7 | Validate persisted state and HTTP responses with zod; replace `JSON.parse as T` | A-09 | M |
| 8 | Lint rule against `as` assertions with a documented allowlist | A-09 | S |
| 9 | Verify provenance attestation in `install.sh` and `upgrade`; ADR for signing | A-04 | M |
| 10 | Unit tests for media adapters with a fake `run-tool`; document `verify` prerequisites | A-06 | M |
| 11 | Explain the nested test summaries; reduce the 170 s suite time | A-07 | S |
| 12 | `childEnvironment()` allowlist for spawned processes | A-12 | S |
| 13 | Move embedded CSS/JS/HTML to real asset files | A-10 | M |

### Later (quarterly)

| # | Action | Findings | Effort |
|---|---|---|---|
| 14 | Scope review of docs/media/accelerator/SDK areas against goals 1 to 3 | A-11 | M |
| 15 | Scheduled read-only live-instance test workflow; Windows and macOS `verify` | A-08 | L |
| 16 | Tidy ADR statuses, `AGENTS.md` status block, spikes archive, changelog size | A-15, A-17 | S |
| 17 | Second audit pass on the areas in section 7 | n/a | L |

## 9. Suggested success measures

- 0 critical or high advisories without a recorded, dated decision.
- `bun run verify` passes on a clean macOS or Linux machine with the documented prerequisites,
  with 0 lint warnings.
- 0 unvalidated `JSON.parse ... as T` in adapters; `as` count trending down.
- Release workflow depends only on SHA-pinned actions, and installers verify provenance.
- A recurring (quarterly) audit that reuses section 2 as its checklist.
