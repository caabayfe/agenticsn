# snagentic v1.0: release plan

- Status: Approved (decisions recorded in ADR-0013, ADR-0014, ADR-0015)
- Date: 2026-10-05
- Builds on: phase 0 (spec 001), ADR-0001 to ADR-0012, spikes S1–S5
- Replaces: the phase order in ADR-0010 for the v1.0 release (an ADR amendment follows
  approval)

## 1. Goal

A **clean, professional v1.0** that:

1. **syncs all instance metadata** to git, efficiently, full and incremental;
2. offers the **core actions**: install plugins, fetch update sets, check the
   environment;
3. is **clean, structured, tested and performant**, with the rules enforced by CI rather
   than by good intentions.

Production troubleshooting (ADR-0012) and governance rule packs (ADR-0006) come after
v1.0.

## 2. Scope

### In v1.0

| Capability | Commands (CLI) | MCP tool | Writes to ServiceNow? |
|---|---|---|---|
| **Workspace**: a dedicated data repository with a standard layout (ADR-0014) | `init [path]`, found automatically from any folder inside it | – | No |
| Instance profiles and credentials | `instance add / list / remove`, `auth login / logout` | – | No |
| Environment and connection check | `doctor`, `doctor --instance <name>` | `doctor` | No |
| **Full and incremental sync** of every `sys_metadata` class, child rows (flows, layouts, workflow activities), operational inventory (plugins, store apps, domains) | `pull [--full]` | `pull` | No |
| Merge remote state into the working branch | `integrate` | – | No |
| What changed, how fresh the mirror is | `status` | `status` | No |
| **Update sets**: list, show entries, detect collisions, export as XML | `update-sets list / show / collisions / export` | `update_sets` | No |
| **Plugins**: list installed and available, activate (CI/CD API, with progress) | `plugins list / activate` | `plugins`, `plugin_activate` | **Yes, development instances only** |

That is 6 MCP tools, within the budget of 12.

### Not in v1.0 (each has a home later)

| Item | Planned |
|---|---|
| Plan and push local edits to update sets (with the governance gate) | v1.1 |
| Governance rules, `check`, `validate`, agent packs and host hooks | v1.1 |
| Table model, search, references, impact, audit | v1.2 |
| Remote update-set validation before promotion, promotion guard | v1.3 |
| Production troubleshooting, read gateway, read-only role verification (S6) | later |
| Intel macOS | unsupported (S3 decision) |

### Decisions (product owner, 2026-10-05)

1. **Plan and push move to v1.1**, with the governance gate (ADR-0013).
2. **Test and production profiles are pull-only**, with an explicit acknowledgement at
   `instance add` until spike S6 is done (ADR-0013).
3. **YAML writing style:** the project's own style (ADR-0015).
4. **Synced data lives in its own workspace repository** with a layout snagentic creates
   and versions, independent of how users organize folders (ADR-0014).
5. Still open before M8: code signing.

## 3. Architecture for v1.0

### 3.1 Contexts and modules

The layering of ADR-0001 is unchanged. These are the modules v1.0 adds. Every file stays
under the size budget in section 6.

```
packages/core/src/
  kernel/                  (done) identifiers, canonical forms, hash, errors
  workspace/
    domain/                manifest, layout version, paths of every artifact relative to
                           the workspace root
    application/           init, locate (walk up to snagentic.yaml), layout check
    ports.ts               WorkspaceStore
  instance/
    domain/                InstanceProfile, InstanceKind, write policy by kind
    application/           add / list / remove profiles
    ports.ts               ProfileStore, CredentialStore
  metadata/
    domain/                Artifact, ArtifactType registry (field → parse mode, language,
                           file extension), record path rules, redaction policy
    serialization/         record directory format: split, read, write (own YAML
                           style, failsafe reading)
  sync/
    domain/                coverage, inventory diff (fetch / skip / delete), watermark
                           and overlap window, quarantine rules, pull plan
    application/           pull-full, pull-incremental, integrate, status
    ports.ts               MetadataSource, MirrorStore, SyncStateStore
  updatesets/
    domain/                UpdateSet, UpdateSetEntry, collision detection
    application/           list, show, collisions, export
    ports.ts               UpdateSetSource
  platform/
    domain/                Plugin, activation request, progress states
    application/           list plugins, activate plugin (development only)
    ports.ts               PluginSource, PlatformOperations
  environment/             (done) doctor; adds instance checks (reachability,
                           authentication, required roles)

packages/cli/src/
  adapters/
    servicenow/            http client (auth, retry, back-off, rate limit), table
                           reader (keyset paging, streaming), cicd client (progress
                           polling), aggregate counts
    git/                   plumbing: private index, blob batch write, commit to ref,
                           merge for integrate
    fs/                    atomic writes, record directory store
    credentials/           OS keychain + environment variables
    profiles/              <workspace>/instances/<name>/instance.yaml
    workspace/             manifest file, git init and large-repository tuning
  registry/                one use case per file (≈ 15 files)
  cli/ mcp/                (done) generators
```

### 3.2 How the pieces talk

```
CLI / MCP ─▶ use case ─▶ application service ─▶ domain (pure decisions)
                               │
                               ▼ ports
             adapters: ServiceNow HTTP · git plumbing · filesystem · keychain
```

The domain decides *what* to do (for example "fetch these 1,240 records, delete these
3"). Adapters do the I/O. This keeps the sync logic testable with no network, which is
what v1's 1,400-line `InstanceSync` could not do.

## 4. Efficient sync design

> Section 4 is governed by **ADR-0016** (instance load and pagination policy), which
> supersedes it where they differ: keyset paging only, two-tier change detection, a
> 10-minute overlap instead of 15 hours, default concurrency 2, and a server cost report.

### 4.1 Full pull

1. **Catalog.** Read `sys_db_object` and the needed `sys_dictionary` rows (classes,
   inheritance, field types). Field types drive the `ArtifactType` registry: which fields
   are scripts and in which parse mode (S4).
2. **Inventory.** List `sys_id`, class, `sys_updated_on` and `sys_mod_count` for every
   in-scope record. Use keyset paging on `(sys_updated_on, sys_id)`, never offset paging,
   and only stop on an empty page (ACLs filter rows after the limit; a v1 lesson).
3. **Diff.** Pure domain function: compare the inventory with the previous snapshot
   index and decide fetch, skip or delete.
4. **Download.** Only records to fetch, batched by class (`sys_idIN…`), with only the
   needed fields (`sysparm_fields`), `sysparm_exclude_reference_link`, `sysparm_no_count`,
   gzip and keep-alive.
5. **Write.** Stream each record to its directory as it arrives (bounded memory).
   Unchanged content (same hash) is not rewritten.
6. **Commit.** Write blobs in batches and commit to `servicenow-remote/<name>` with git
   plumbing, never touching the user's index or working tree. Candidates (`git
   fast-import` vs batched `hash-object` + `update-index`) are measured in milestone M3.

### 4.2 Incremental pull

- Delta query on `sys_metadata` since the watermark minus an overlap window (v1 used 15
  hours to absorb time-zone interpretation), plus changed `sys_update_xml` names.
- Deletes from `sys_metadata_delete`, `sys_update_xml` DELETE entries, and a presence
  check of candidates. `pull --full` remains the safety net.

### 4.3 Concurrency and politeness

- **One shared request scheduler per instance**: a concurrency limit (default 6), an
  adaptive rate limit, `Retry-After` honored on 429 and 503, exponential back-off with
  jitter, and a per-run request budget.
- **Resumable.** Progress is checkpointed after each class batch. An interrupted full
  pull continues instead of restarting.
- **Observable.** Progress events (classes done, records, requests, retries) reach the
  CLI (progress line) and MCP (progress notifications).

### 4.4 Performance targets (initial)

| Measure | Target | How it is checked |
|---|---|---|
| Full pull of the PDI (≈ 280k records) | Baseline in M3, then ≤ v1's time | Live run against the PDI, recorded in a report |
| Incremental pull, nothing changed | ≤ 5 requests and < 10 s (ASR-16) | Live PDI run plus the server cost report |
| Incremental pull, 100 changed records | < 60 s | Live PDI run |
| Peak memory during a full pull | < 1 GB | Measured in the same run |
| Requests per changed record (incremental) | ≤ 2 amortized | Counted by the scheduler; asserted in benchmarks |
| Domain diff of a 250k-record inventory | < 2 s | Benchmark against the fake ServiceNow, in CI |

## 5. Core actions

### 5.1 Update sets

- `list`: open update sets, and those changed in the last *N* days (default 30): name,
  state, application, owner, entry count.
- `show <id>`: entries (type, action, target, author, date), without payloads by default.
- `collisions`: records captured in more than one open update set.
- `export <id>`: the update set as ServiceNow XML (the same format as "Export to XML"),
  for archiving or moving between instances by hand.

### 5.2 Plugins

- `list`: installed and available plugins and store applications, with versions. This
  comes from the operational inventory, so it works offline after a pull.
- `activate <id>`: uses the supported CI/CD API (`/api/sn_cicd/plugin/{id}/activate`) and
  polls `progress/{id}`.
  - Development instances only: the use case is not registered for other kinds.
  - Requires `--confirm` on the CLI; flagged `destructive` for MCP hosts.
  - Reports progress, and the final state from the progress record.
  - **Not retried automatically after an ambiguous failure.** A timeout is reported as
    "state unknown, check progress <id>", never re-run.

## 6. Code quality, enforced in CI

| Rule | Limit | Enforced by |
|---|---|---|
| File size (product code) | ≤ 300 lines | New `size` check in `verify` (fails the build) |
| Function size | ≤ 50 lines | Biome `noExcessiveLinesPerFunction` |
| Cognitive complexity | ≤ 15 per function | Biome `noExcessiveCognitiveComplexity` |
| Architecture boundaries | ADR-0001 rules | dependency-cruiser (done) |
| Coverage | ≥ 90% per file | `bun test --coverage` (done) |
| Test-first | Every behavior has a spec-named test | Code review against the use-case specs |
| Domain test strength | Mutation score ≥ 80% on `domain/` | Tool to be chosen in M2: Stryker has no `bun test` runner (status recorded in M0) |
| Adapter correctness | Contract suite per port: fake and recorded-HTTP implementations must pass the same tests | `bun test` |
| Performance | Benchmarks in section 4.4 that run in CI | Nightly workflow, fails on > 20% regression |

Existing v1 behavior is ported **from its tests and spikes, not its code**. The
`FakeServiceNow` from v1 becomes a typed in-memory fake shared by all contract tests.

## 7. Milestones

Each milestone is a series of small pull requests (each one merged when `verify` and
`build` are green) and ends with something you can run.

| # | Milestone | You can… | Exit criteria |
|---|---|---|---|
| M0 | Quality gates (done) | See CI reject an oversized file or function | Size, function and complexity checks active, each proven by a test |
| M1 | Workspace, instances and connection (done) | `init ~/snagentic/pdi`, `instance add`, `auth login`, `doctor --instance pdi` from any folder in the workspace | Workspace discovery and layout version check; `init` refuses nested repositories; OAuth and basic auth; credentials only in the keychain or env; per-instance request scheduler (ADR-0016); secret redaction in all errors; timestamp-semantics probe; contract tests |
| M2 | Metadata model and disk format (done; layout per ADR-0017) | Read any v1 mirror; write records in the new style | `ArtifactType` registry from the catalog; S2 parity test as a permanent regression test; redaction and quarantine |
| M3 | Full pull (done; baseline in docs/reports/pull-baseline-pdi.md) | `pull --full` of the PDI into a fresh repo | `KeysetPager` with property tests (no gaps, no duplicates, stall detection); resumable; baseline performance report; git commit strategy chosen by measurement |
| M4 | Incremental pull, integrate, status | Change a record in the PDI, `pull`, `integrate` | Fast feed (≤ 5 requests when nothing changed); fingerprint reconciliation (`pull --verify`); deletes detected; server cost report; `status` shows freshness and pending changes |
| M5 | Update sets | `update-sets list / show / collisions / export` | Export matches ServiceNow's XML format (checked against a real export) |
| M6 | Plugins | `plugins list`, `plugins activate` on the PDI | Development only; progress reporting; no automatic retry of ambiguous failures |
| M7 | MCP and documentation | Use every v1.0 tool from Claude Code and Copilot | Command reference generated from the registry; getting-started guide |
| M8 | Release v1.0.0 | Install with one command on macOS, Windows, Linux | Release workflow (tag → build → checksums → GitHub release); install scripts; Homebrew tap; changelog; all section 4.4 targets met or explicitly accepted |

## 8. Release engineering (M8)

- Semantic versioning; `v1.0.0` is tagged from `main` after M7 is green.
- A release workflow builds the four supported binaries, writes `SHA256SUMS`, and attaches
  build provenance (GitHub artifact attestations).
- Install: `curl … | sh` (macOS, Linux), `irm … | iex` (Windows), `brew install`.
- **Signing.** macOS notarization needs an Apple Developer account, and Windows signing
  needs a code-signing certificate. Without them the binaries work, but macOS Gatekeeper
  and Windows SmartScreen warn on first run. *Decision for you before M8.*

## 9. Risks

| Risk | Mitigation |
|---|---|
| Full-pull performance is dominated by ServiceNow API limits | Measure early (M3); adaptive concurrency; resumable pulls |
| Writing ≈ 280k small files is slow on some file systems (3.1 GB for the v1 PDI working tree) | Skip unchanged files by hash; batched git blob writes; measured in M3 |
| Plugin activation is long and can end in an unknown state | Durable progress id; never auto-retry; `status` shows it |
| Instance data committed to the wrong repository | Workspaces are separate repositories; `init` refuses nesting; the snagentic source repository ignores `instances/` and `snagentic.yaml` |
| Scope creep (the v1 failure mode) | Section 2 is the contract; anything else needs an ADR |
| Credentials for test and production without S6 | Pull-only kinds plus explicit acknowledgement (decision 2) |
