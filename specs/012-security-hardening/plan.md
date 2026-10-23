# 012. Security hardening: plan

- Status: Draft (2026-10-22). Step 1 in #121; step 2 in #122 (stacked on #121; live check on pdi2 open); step 3 in #123
- Date: 2026-10-22
- Source: code audit 2026-10-21 (`docs/reports/code-audit-2026-10-21.md`, PR #120), findings
  A-01 to A-04, A-09, A-10, A-12, A-13 and the security areas of its section 7
- Serves: the safety invariants in `AGENTS.md`; ADR-0011 (guarantees are enforced in code, CI
  or credentials); ADR-0012 (read-only test and production); ADR-0023 (delivery and upgrade)

## 1. Goal

Close the audit's security findings gradually: one small pull request per step, each passing
`bun run verify`, with no change in product behaviour except where a step says so.

## 2. Findings, as checked on `main` (2026-10-22)

Each audit finding was rechecked before planning.

| ID | Finding | Rechecked | Severity |
|---|---|---|---|
| A-01 | `bun audit`: 32 advisories (2 critical, 11 high, 14 moderate, 5 low) | Same count; all via `@servicenow/sdk*` 4.13.6 | High until triaged |
| A-02 | No Dependabot, CodeQL or audit step in CI | Confirmed | High |
| A-03 | Actions pinned by tag | Confirmed in all four workflows, not only `release.yml` | Medium |
| A-04 | `SHA256SUMS` comes from the same release; attestation never verified | Confirmed: `github-releases.ts:60`, `install.sh:37`, `install.ps1:22` | Medium |
| A-12 | Full `process.env` reaches child processes, with `SNAGENTIC_<NAME>_PASSWORD` | Confirmed: `run-git.ts:13,42`, `git-mirror.ts:287`, `fast-import.ts:33`, `gh-pull-requests.ts:89`, `git-pack-workspace.ts:32`; `sdk-runtime.ts:160` sets `NO_TELEMETRY` globally | Low |
| A-13 | No `SECURITY.md`, `LICENSE`, `CONTRIBUTING.md`, `CODEOWNERS` | Confirmed; private vulnerability reporting is off on the public repo | Low |
| A-09 | Persisted state and HTTP responses cast without validation | Examples confirmed, not counted | Low (integrity) |
| A-10 | `postMessage(…, '*')` in the documentation site | Confirmed; the player's `message` listener (`player-script.ts:126`) also doesn't check the sender. It only toggles sound | Low |

### A-01 first triage (to confirm in step 2)

- **No newer SDK exists**: 4.13.6 is the latest published `@servicenow/sdk`. Only `overrides`
  can help now.
- `handlebars` (both criticals) is used only by `sdk-api/dist/project-factory`, the project
  scaffolder. snagentic imports `Orchestrator`, `Project` and `Connector` from `sdk-api`
  (`sdk-runtime.ts:3`, `scheduler-connector.ts:1`) and never scaffolds.
- `fastify`, `@fastify/static`, `joi` and one `undici` path come through
  `@servicenow/isomorphic-rollup` (the SDK's UI dev server). The other `undici` comes through
  `@servicenow/sdk-cli`, which snagentic doesn't import.
- Patched versions exist: `handlebars` 4.7.10, `fastify` 5.12.7, `@fastify/static` 10.1.7.
  `braces` 3.0.3 is already the latest; it needs a recorded acceptance.

## 3. Steps

Effort: S under 1 day, M 1 to 3 days, L over 3 days.

| # | Step | Findings | Effort | Needs |
|---|---|---|---|---|
| 1 | Repository basics | A-02, A-03, A-13 | S | — |
| 2 | Triage and reduce advisories | A-01, A-02 | M | — |
| 3 | `childEnvironment()` for spawned processes | A-12 | S | — |
| 4 | Verify release provenance in `upgrade` and the installers | A-04 | M | ADR amending ADR-0023 |
| 5 | Validate data at adapter edges; narrow `postMessage` | A-09, A-10 | M | — |
| 6 | Second review of the areas the audit did not assess | §7 | L | — |

### Step 1. Repository basics

- `.github/dependabot.yml`: `bun` and `github-actions`, weekly, grouped; TypeScript majors
  ignored (toolchain note in `AGENTS.md`).
- Every action pinned to a full commit SHA with its version as a comment. The SHAs are the ones
  the major tags pointed to on 2026-10-22, so runs don't change.
- `SECURITY.md` (private reporting through GitHub, scope = the safety invariants) and
  `.github/CODEOWNERS`.
- **Owner:** enable private vulnerability reporting in the repository settings; decide the
  `LICENSE` terms (depends on ADR-0008, still Proposed); `CONTRIBUTING.md` follows the licence.

### Step 2. Triage and reduce advisories

Outcome (2026-10-22): `overrides` took the audit from 32 advisories to 7 (0 critical, 4 high);
the 7 left are accepted in `docs/security/advisories.md` until 2027-01-20, with the reachability
evidence; `scripts/check-advisories.ts` and `.github/workflows/advisories.yml` enforce the
register. The real SDK still builds the `doctor` test flow. **Open:** a build and push of a
Fluent change on pdi2 with the release binary (needs the owner for the keychain prompt).

1. Prove reachability from the build: build with a metafile and list whether `handlebars`,
   `fastify`, `@fastify/*`, `joi` and `undici` are in the compiled binary, and from which
   imports. If the scaffolder is bundled but unused, consider excluding it in
   `scripts/build-patches.ts`.
2. Add root `overrides` for each package with a compatible patched version. Run the Fluent build
   tests, `bun run build`, and a build and push against pdi2.
3. Write `docs/security/advisories.md`: one row per remaining advisory with package, advisory
   id, reachability, decision (fixed, accepted, waiting), date and expiry. A plain document, not
   an ADR, because it changes as advisories arrive.
4. A scheduled workflow (weekly and on pull requests touching `bun.lock`) that runs
   `bun audit --json` and fails only on an advisory missing from the register, or past its
   expiry. Test the comparison as a script with fixtures.

### Step 3. `childEnvironment()`

Outcome (2026-10-22, #123): 11 spawn sites, not 6: five more inherited the environment by
setting no `env`. The helper drops what `isCredentialVariable()` names and keeps the rest; an
architecture test fails on a spawn without it. Not an allowlist: git and gh need `HOME`,
`SSH_AUTH_SOCK`, proxies and `GH_TOKEN`, and only snagentic's own secrets are its to withhold.
`NO_TELEMETRY` stays on `process.env`, because the in-process SDK reads it there and it isn't
a secret.

- First test: `it("does not pass instance credentials to git")`.
- One adapter helper builds each child's environment from an allowlist per tool (git, gh,
  ffmpeg and the media tools) and always drops `SNAGENTIC_*_PASSWORD` and other credential
  variables. Replace the six `{ ...process.env }` sites.
- Scope `NO_TELEMETRY` instead of mutating `process.env`; the SDK runs in process, so check
  whether it reads the variable at call time.

### Step 4. Release provenance (ADR first)

- ADR amending ADR-0023: what `upgrade` and the installers verify, and what happens when they
  can't.
- `snagentic upgrade` and `install.sh`/`install.ps1` run `gh attestation verify` when `gh` is
  available, and say so when it isn't.
- Decide in the ADR whether to sign `SHA256SUMS` (minisign or cosign) with a public key shipped
  in the binary, so `upgrade` can verify without `gh`.

Outcome (2026-10-23, #139): ADR-0043 (accepted 2026-10-23) amends ADR-0023. `upgrade` checks
the attestation after the checksum and before running the new binary; the installers do the
same. The check requires this repository, the release workflow and the version's tag
(`--source-ref`), and a failure installs nothing. Without `gh`, or signed out, they install on
the checksum and say so. No signing key of our own for now. Every release from 1.0.0 to 2.6.0
has an attestation, so `upgrade --to` an older one still works. `install.ps1` is not run by any
test.

### Step 5. Validate at the edges

Outcome (2026-10-23): zod schemas check the six local state files (sync state, checkpoint,
catalog, install and push journals, knowledge index rows), with older optional fields still
loading; a file that doesn't match stops with `invalid-state-file`, the field at fault and the
next action. Table, Aggregate, transaction-log and CI/CD answers are checked for the fields
read, with no request changes. Not a Biome rule (there is none): an architecture test parses
product code and allows 16 assertions, each with its reason, down from 36. `postMessage` keeps
`"*"`: the sandboxed player's origin is opaque, so no origin can name it, and a site opened from
disk has none. Both sides now check `e.source` instead, which is the stronger check here.

- zod schemas instead of `JSON.parse(...) as T` in `json-sync-state-store.ts`,
  `json-install-journal.ts` and `sqlite-knowledge-store.ts`; then the responses in
  `servicenow-client.ts`, `cicd-plugin-activator.ts` and `server-cost.ts`. A corrupt or older
  file fails with a `SnagenticError` naming the file and the next action.
- A lint rule against `as` assertions with a commented allowlist.
- `postMessage` to the page's own origin; listeners check `e.source` and `e.origin`.

### Step 6. Second review

The audit's section 7 lists areas it didn't read. Review for security: input validation of MCP
and CLI use cases (zod schemas, path inputs), the keychain adapter, secrets in logs and error
messages, and the threat model of running the Fluent SDK inside the binary (ADR-0032). Findings
become new steps here.

## 4. Done when

- 0 critical or high advisories without a dated decision in the register, and CI tells us about
  new ones.
- Every workflow action pinned by SHA and kept current by Dependabot.
- No child process receives a snagentic credential it doesn't need.
- `upgrade` and the installers verify where a binary came from, not only that it matches its
  sums.
- No unvalidated `JSON.parse ... as T` at adapter edges.
