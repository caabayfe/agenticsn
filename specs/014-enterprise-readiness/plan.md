# 014. Enterprise readiness: plan

- Status: Draft (2026-11-10), for the product owner
- Date: 2026-11-10
- Source: enterprise-readiness audit of `main` 6b458a6 (release 2.19.1), 2026-11-10. It used five
  independent reviews (security, performance, quality, reliability, enterprise readiness), the
  repository's gates, mutation checks of 8 safety guards, and benchmarks with synthetic data. It
  made no live-instance calls. The report stays local until its security findings ship, as for
  the 2026-10-23 review; this plan names those findings by ID only.
- Serves: G1-G3; ASR-06 (team scale), ASR-07 and ASR-16 (instance scale and load), ASR-08 (data
  protection); the safety invariants in `AGENTS.md`

## 1. Goal

Make snagentic safe to roll out to a large enterprise: about 200 developers, enterprise-size
instances, and a security, legal and procurement review. Each step is one small pull request
that passes `bun run verify`. Steps that change a decision get an ADR first.

**Done when:**
- a re-audit scores every dimension at least 8/10;
- the enterprise-readiness blockers in §2 are closed;
- two clones and a stateless CI runner share one mirror with no second full pull (ADR-0052);
- a no-change pull is measured on a large non-production instance.

## 2. Where we start

| Dimension | Score | Main reasons |
|---|---|---|
| Security | 7/10 | Core controls hold; 4 Medium findings open (SEC-01..04), and several Lows from the 2026-10-23 review |
| Code quality / architecture | 7/10 | Tool-enforced discipline is excellent; scope, context boundaries and policy in `cli` have drifted |
| Testing / reliability | 7/10 | 8/8 guard mutants killed, 99.5 % coverage; no live checks, Linux-only tests, no locks |
| Performance / scalability | 6/10 | ADR-0016 is followed; unmeasured beyond one PDI, load limits not wired |
| Enterprise readiness | 4/10 | No licence, unsigned binaries, no per-user SSO, no stable channel, one maintainer |

**Blockers for rollout:**
- no licence (ENT-01);
- unsigned binaries (ENT-02, SEC-03);
- no per-user SSO/MFA sign-in (ENT-04);
- no stable release channel or ServiceNow compatibility matrix (ENT-03).

**Team mode isn't supported end to end yet** (ASR-06, ADR-0004), although it is how the owner
means teams to work: one pull per instance, and everyone else gets the mirror through git. Today:
- pull state is local (`.snagentic/<name>/`, ADR-0014), so a new clone or CI runner has to pull
  everything again;
- `status` and the skills tell a git-only developer to pull from the instance;
- commands read only the local branch `servicenow-remote/<name>`, which a fetch doesn't update;
- nothing stops two pullers from splitting the mirror's history;
- without the catalog, `describe` loses inheritance and `adopt` builds its secret-field catalog
  from the units' own tables only.

ADR-0052 proposes the fix.

## 3. Decisions for the owner

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | Licence (ADR-0008) | BUSL 1.1 with the Additional Use Grant already proposed, reviewed by a lawyer. Until then, an evaluation licence for named pilot customers | E1 |
| D2 | Who owns the signing identities | An organisation, not a person: Apple Developer ID (about $99 a year) and Azure Trusted Signing (about $10 a month) | E2 |
| D3 | Repository home and a second maintainer | Move to a GitHub organisation; two code owners for `packages/core`, `.github/` and `packaging/` | E7 |
| D4 | Release policy | A quarterly stable (LTS) line with security fixes backported for 6 months; an edge line as today; accelerator packs released on their own | E5 |
| D5 | A large instance to measure on | A non-production clone with at least 1M `sys_metadata` rows, read-only credential, agreed load window | P3 |
| D6 | Per-user sign-in | OAuth authorization code with PKCE: each instance admin registers one OAuth application once | E3 |
| D7 | Shared-mirror defaults (ADR-0052) | `maxAge` 15 minutes; the CI service account is the only publisher | T1 |
| D8 | Product scope (QUAL-01) | Keep the features, but move documentation/media and accelerators out of `core` into their own packages after stage 2 | Q4 |
| D9 | Personal data in the mirror (`sys_created_by`, `sys_updated_by`) | Keep it (authorship is evidence) and document it in the data-processing note | E6 |
| D10 | A PDI and a CI secret for the scheduled live suite | One dedicated PDI, a read-only user plus a development user, stored as GitHub environment secrets | R2 |

## 4. Steps

Effort: S under 1 day, M 1 to 3 days, L over 3 days. Steps without a decision or ADR can start now.

### Stage 0. Correctness and safety fixes (start now, no decisions needed)

| # | Step | Findings | Effort | Needs |
|---|---|---|---|---|
| F1 | `bun run verify` passes on macOS | 3 files under the per-file function threshold on darwin only | S | — |
| F2 | The advisory register records version and path; zod override | SEC-04 | S | — |
| F3 | Update set export hardening | SEC-01 (details in the local report) | S | — |
| F4 | One write gate, by type as well as by flag | QUAL-03, REL-06 | M | — |
| F5 | A push that succeeded is reported as succeeded | REL-04, part of QUAL-10 | S | — |
| F6 | Workspace lock for mutating use cases | REL-03 | M | — |
| F7 | A resumed install runs the approved plan | REL-05 | S | — |
| F8 | Environment that redirects instance traffic | SEC-05, ENT-08 | S | — |
| F9 | Documentation drift, with a generated ADR index | QUAL-06, ENT-10 (stale counts) | M | — |

- **F1.** Find why the three files lose function coverage on darwin: `fluent-runtime-loader.ts`,
  `docs-build.ts` and `docs-check.ts`. Cover the code those runs miss, or make the skip explicit.
  Never lower the threshold.
- **F2.**
  - `check-advisories.ts` matches the package version and dependency path, as well as the GHSA ID.
    A decision recorded for another version fails the check.
  - Override `zod` to the fixed 4.x for the SDK's copies, then confirm the SDK still builds the
    `doctor` test flow.
  - Fix the register's stale rows (zod, fast-uri paths).
- **F3.** Apply the same checks to export that pull and adopt already apply. Write exports where
  the workspace never commits them by accident. Test with the literal samples from the local
  report.
- **F4.**
  - Nested use cases (`callerFor` in `install-steps.ts`) go through `executeUseCase`, so they get
    the same checks as every other call.
  - A connection exposes write ports only when the instance is a development instance; a write
    to test or production then can't be expressed in code.
  - A registry test runs every `readOnly: true` use case against a writer that throws.
- **F5.**
  - The ledger commit after a push can fail, for example on a commit-msg hook that needs a ticket
    key. That failure becomes a warning in the push result, with the command to run: the push is
    not reported as an error.
  - `runGitOrThrow` raises `GitCommandFailedError` (environment category, git's stderr, a hint).
  - Tests cover both.
- **F6.**
  - One workspace lock for every use case that writes the mirror or an instance: push, pull,
    adopt, take-over and install.
  - `update-ref` with the expected old value.
  - The push writes the preference journal before it switches a preference.
  - A stale lock is recovered by PID, as the install lock already is.
- **F7.** The install journal records the pack, its version, the modules and a hash of the plan
  (instance state left out). A resume refuses when any of them changed, and still refuses on
  blocking problems.
- **F8.**
  - The hook and MCP configuration checks refuse settings that change where instance traffic goes
    or which certificates are trusted.
  - `doctor` shows the proxy and extra CA in use.
  - `docs/guides/network.md` documents the supported corporate setup: proxy, `NO_PROXY`,
    corporate CA.
- **F9.**
  - Generate the ADR index from each file's status line, with a staleness test like the one for
    `commands.md`.
  - Bring `docs/product/*` up to 2.x, with counts taken from code.
  - Fix the layout in `AGENTS.md` (adapters live in `packages/cli`).
  - Record ADR-0038 §5 as accepted but not built.

### Stage 1. Team scale and instance load (before many developers)

| # | Step | Findings | Effort | Needs |
|---|---|---|---|---|
| T1 | Shared mirror: pull state in the mirror commit, fetch-aware pull and integrate, publish | Team-mode gaps (§2), PERF-03 | L | ADR-0052 accepted; D7 |
| T2 | Team-mode guide, CI pull template, per-developer identity | ADR-0004 (CI templates are part of the product), ENT-09 (templates) | M | T1 |
| P1 | Load controls an instance owner can set | PERF-04, PERF-05, PERF-06 | M | ADR amending ADR-0016 |
| P2 | Memory bounded by page, not by table | PERF-07 | M | — |
| P3 | Measure on a large instance; fix what it shows | PERF-01, PERF-02, PERF-09 | L | D5 |
| R1 | Tests on macOS and Windows; hermetic git tests; media tests as a separate job | REL-02, REL-07, REL-08 | M | — |
| R2 | Scheduled live suite and recorded fixtures | REL-01 (A-08) | M | D10 |

- **T1.** Build ADR-0052 test-first. Acceptance:
  - a second clone that never pulled runs status, integrate, describe (with inheritance), adopt,
    plan and push;
  - a fresh CI runner continues incrementally from the fetched branch;
  - two publishers can't split the branch's history.
- **T2.**
  - The guide: one designated puller, branch protection on `servicenow-remote/*`, what
    developers run.
  - A GitHub Actions template for the scheduled pull and publish, with GitLab and Azure DevOps
    templates later.
  - Check and fix how a committed `instance.yaml`, which holds one `username`, works when each
    developer signs in as themselves (ADR-0004 team mode). Suspected gap; not checked in the audit.
- **P1.**
  - One request scheduler per instance per process, shared by concurrent MCP calls.
  - Maximum concurrency, requests per second and a run budget, set by an administrator.
    Lower defaults on test and production.
  - A request timeout counts as pressure, and is retried at most once with a smaller page.
  - The `syslog_transaction` cost report is opt-in, development only, or computed from
    `Server-Timing`.
- **P2.**
  - Child rows are written per owner as each owner completes.
  - A compact mirror file index.
  - A memory test at 2M synthetic records.
- **P3.**
  - Measure on the large instance: a no-change pull, a 100-change pull, and a full pull, with
    requests, server time and client memory.
  - Then fix by evidence: make `sys_update_xml` the primary change feed if the `sys_metadata`
    feeds scan; replace table counts with a cheap probe; skip the empty page of one-page listings.
  - Publish the numbers in `docs/reports/`.
- **R1.**
  - `verify` legs on `macos-15` and `windows-latest`; a check that the macOS sandbox tests ran.
  - A test preload that isolates the user's git configuration.
  - Chrome and ffmpeg tests in their own job.
- **R2.**
  - Weekly, and on every SDK bump: read-only tests, then the Fluent round trip on a throw-away
    scope. Each run logs the platform family and patch.
  - Recorded request/response pairs become fixtures that the fake instance is checked against.

### Stage 2. The enterprise package

| # | Step | Findings | Effort | Needs |
|---|---|---|---|---|
| E1 | `LICENSE`, `THIRD_PARTY_NOTICES`, attested CycloneDX SBOM, licence allow-list check | ENT-01, ENT-07 | M | D1 |
| E2 | Signed and notarized binaries; strict provenance mode | ENT-02, SEC-03 | M | D2 |
| E3 | OAuth authorization code with PKCE for people; client credentials stay for CI | ENT-04 | L | D6; ADR amending ADR-0021 |
| E4 | Audit log of instance writes; log levels; `doctor --report` | ENT-06 | M | ADR |
| E5 | Release policy, LTS line, ServiceNow compatibility matrix | ENT-03, ENT-11 | M | D4; R2 |
| E6 | Data-processing note: instance to laptop to git to model provider | ENT-10 | S | D9 |
| E7 | Organisation repository, second maintainer, support statement, issue templates | ENT-05 | S | D3 |
| E8 | SDK worker sandbox on Linux and Windows; a setting that refuses unsandboxed builds | SEC-02 | L | ADR-0044 follow-up |
| E9 | Machine policy file, SARIF output | ENT-09 | M | ADR |

- **E2.**
  - Developer ID plus `notarytool` on macOS, Authenticode on Windows, both in `release.yml`.
  - `SNAGENTIC_REQUIRE_PROVENANCE=1` makes `install.sh`, `install.ps1` and `upgrade` refuse a
    release whose provenance they can't check.
  - A signed MSI or winget package, and a notarized pkg or Homebrew tap.
- **E3.**
  - Loopback redirect, refresh token in the keychain bound to the instance as in ADR-0020, and
    `auth login --browser`.
  - A least-privilege role guide for each instance kind.
  - Document `snc_basic_auth_api_access`.
- **E4.**
  - An append-only `.snagentic/audit.jsonl`: time, OS user, instance, kind, use case, plan id,
    update set sys_ids, result and request count. It can also be forwarded to syslog or OTLP.
  - `--log-level`, with the same redaction as errors.
  - `doctor --report`: a redacted support bundle.
- **E5.**
  - SemVer and a deprecation policy that treat the workspace format, ledgers, CLI flags and MCP
    schemas as API.
  - A stable channel in `upgrade`.
  - A family × version matrix, filled by R2 on each family.
  - Decide on Intel Macs.
- **E9.**
  - A machine-wide policy, deployable by MDM: allowed instance hosts, version bounds, upgrade off,
    required rule packs, waiver approvers.
  - `validate --format sarif`.

### Stage 3. Maintainability (alongside, after stage 0)

| # | Step | Findings | Effort | Needs |
|---|---|---|---|---|
| Q1 | Context boundaries enforced by dependency-cruiser | QUAL-02 | M | — |
| Q2 | Policy out of `cli/registry`; install collisions recognised by update set sys_id | QUAL-04 | M | — |
| Q3 | `UseCaseContext` split into slices; each use case declares what it needs | QUAL-05 | M | — |
| Q4 | `packages/docs` and `packages/accelerators` out of `core` | QUAL-01 | L | D8 |
| Q5 | Low findings, batched by area | see below | M | — |

- **Q1.**
  - Move `KeysetPager`, `concurrently` and `fingerprint` to `connection/`.
  - Move `Unit`, `Ledger` and `PlanUnit` to `metadata/`, or export them through an `index.ts`.
  - Give every context an `index.ts`.
  - Add the cross-context rule.
- **Q2.**
  - Move pull session selection and the collision re-plan into core services.
  - An update set counts as the install's own by the sys_id the journal recorded, not by its
    name.
- **Q3.** Add a test that read-only use cases never receive credentials.
- **Q5.** Batched by area:
  - QUAL-08: SDK version constants checked against the pinned SDK.
  - QUAL-09: web assets as linted files.
  - QUAL-10: no bare `Error` in `application/`.
  - QUAL-11: shared helpers.
  - QUAL-12: Biome warnings fail `verify`.
  - PERF-08: map-based script matching.
  - PERF-10: build worker timeout and cancellation.
  - PERF-11..13.
  - REL-09: merge-conflict hint.
  - REL-10: only ENOENT means "no journal".
  - SEC-06..09 and the open B-items from the 2026-10-23 review.

**Not planned:**
- QUAL-13, pruning the 518 core exports: low value until Q4 changes the package boundaries.
- QUAL-14, finding IDs in comments: a glossary in `docs/` is enough.

## 5. Order

```
Stage 0  F1 F2 F3 F4 F5 F6 F7 F8 F9            (now; independent, small PRs)
Stage 1  ADR-0052 -> T1 -> T2   P1  P2  R1       (now)   P3 (D5)   R2 (D10)
Stage 2  E7 E6 (quick)   E1 (D1)   E2 (D2)   E3 (D6)   E4   E5 (D4, R2)   E8   E9
Stage 3  Q1 Q2 Q3 Q5 alongside;  Q4 after stage 2 (D8)
Re-audit after stages 0+1, and again after stage 2.
```

A pilot with one enterprise team can start after stage 0, T1, T2, P1 and E1. Rollout to many
developers needs stages 1 and 2.
