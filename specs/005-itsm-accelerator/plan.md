# 005. ITSM accelerator: plan

- Status: Approved by the product owner (2026-10-14; decisions P1–P4 in section 7)
- Date: 2026-10-13, updated 2026-10-14
- Implements: ADR-0026 (accelerators as content packs), ADR-0028 as amended (flows)
- Builds on: ADR-0013 (plugin activation), ADR-0016 (instance load), ADR-0025 (scoped
  applications from files), spec 004 (plan and push)
- Functional design: `functional-design.md` (this folder). Its "Implementation batches" table
  is superseded by this plan.

## 1. Goal

snagentic installs the ITSM accelerator on **any development instance**, repeatably, through
its normal flow, and every later wave or accelerator is added as **pack content, not code**.

The work splits in two tracks that must not be mixed:

| Track | What | Where | Shape of change |
|---|---|---|---|
| **A. Mechanism** | Pack format, `accelerator` use cases, gate check, data loading | `packages/core`, `packages/cli` | Code, TDD, one release |
| **F. Flows** | Flow delivery from Fluent source (ADR-0028 as amended) | `packages/core`, `packages/cli`, build | Code, TDD, its own release |
| **B. Content** | The ITSM pack: wave 0 and wave 1 | `nttdata/accelerators/itsm/` (P2) | Files, validated by the pack tests and `validate` |

Track F ships first, as v1.7.0 (P4): flows are useful beyond accelerators, and wave 1 needs them.
Track A follows as v1.8.0, proven with a **minimal test pack** (one scoped application, one property,
one patch to an out-of-box record, one data entity). Track B starts once A's install path works
end to end on the PDI.

## 2. Scope

### In this spec

| Capability | CLI | MCP | Writes to ServiceNow? |
|---|---|---|---|
| List packs, check one against an instance | `accelerator list`, `accelerator check <pack> <instance> [--waves] [--capabilities]` | `accelerator` (13th tool, read-only) | No |
| Add a pack's files to the workspace | `accelerator add <pack> [--waves] [--capabilities]` | – | No (workspace only) |
| Validate data templates | `accelerator load <pack> --data <dir> --validate-only` | – | No |
| Load data templates | `accelerator load <pack> <instance> --data <dir> --confirm` | – | **Yes, development only** |
| Block pushes whose capability lacks its plugins | inside `plan_push` / `push` | (existing) | – |
| ITSM pack, wave 0 (foundation) and wave 1 (Incident, tasks, parent/child, MIM, On-Call, SLAs, portal, seed knowledge, AI tier 1) | – | – | through the commands above |

### Not in this spec

| Item | Why / where |
|---|---|
| Waves 2 to 4 | Later pack versions; no mechanism change expected. A wave that needs one gets its own ADR. |
| AI tiers 2 and 3 (Now Assist skills, AI agents, voice agent) | Need licences not on the PDI; content added when entitled. `check` reports them as not entitled. |
| Twilio, Teams credentials | Delivered as aliases and connection records without secrets; credentials are set on the instance. |
| Loading test and production instances | ADR-0012. Done on the instance with the same import sets; `--validate-only` checks the files. |
| Packs from outside the binary | ADR-0026, deferred. |
| ATF execution after push | Spec 004, D1: needs its own ADR. ATF tests are delivered as files; running them is manual. |
| Domain separation path | Cannot be enabled on a PDI; `check` detects it and the pack carries the data tagging, untested live. |

## 3. Spikes (before track A's code that depends on them)

| # | Question | Decides | How |
|---|---|---|---|
| S-A | **Half done 2026-10-14 (`tools/spikes/s-a-b-pack-install/`): the Table API creates `x_nttdata_s005a` as given on an instance with company code 2222332. Moving its update set to a second instance needs a second PDI (with flows test B2).** **Vendor prefix.** Can the Table API create `x_nttdata_acc` on an instance whose company code is not `nttdata`? Does an update set holding it then move to another instance? | ADR-0026 open item: fixed scope (if yes) or a per-instance scope parameter (if no). Recorded as an amendment to ADR-0026 | PDI: create `sys_app` with a foreign prefix through push's write path; export its update set; preview on a second PDI |
| S-B | **Done 2026-10-14: single-row import is synchronous with a per-row status (inserted, updated, ignored) and target sys_id, ~340 ms a row, coalescing makes re-runs idempotent; insertMultiple is asynchronous and stays pending. Minimum role not tested.** **Import Set API.** `POST /api/now/import/<table>` and `insertMultiple`: is the transform synchronous, what does each row report, how does coalescing behave on re-run, which roles does it need? | Load adapter design and its contract suite | PDI, scratch import set table, two runs of the same 20 rows |
| S-C | **Done 2026-10-14 (`tools/spikes/s-c-metadata/`): metadata: SLA definitions, schedules, assignment rules, data lookups, notifications, inbound actions, record producers, VA topics, workspace configuration, PI indicators, roles, properties, flows, ACLs; records (data): schedule entries, rotas, knowledge bases and articles, groups, locations, companies, services, offerings.** **What is metadata.** For every artifact type wave 0 and 1 need (SLA definitions, schedules, rotas, assignment rules and data lookups, notifications, inbound actions, record producers, knowledge bases, VA topics, workspace configuration, PI definitions), is it `sys_metadata` (push) or a record (load)? | The pack's split between `metadata/`, `patches/` and `data/` | Query `sys_db_object` hierarchy on the PDI; recorded as a table in this spec |
| **S11** | **Flows (gate, product owner 2026-10-13).** Flows are a core capability for the accelerator and beyond, and must be delivered from files: published, running, editable in Flow Designer, captured in the batch, pulled back. Today flow child rows are read-only (ADR-0025, item 2) and their `values` are gzipped JSON. | An ADR on flow delivery. **Nothing else in this spec starts before it is accepted.** | `tools/spikes/s11-flow-delivery/README.md`: Fluent Flow API built to update XML and committed through the CI/CD API (preferred), `now-sdk install`, the Flow Designer API |

S11 runs first. S-C is desk work plus one PDI query; S-A and S-B are short PDI sessions. Each
result is written into this plan before the dependent milestone starts.

## 4. Architecture

### 4.1 New context `accelerators`

```
packages/core/src/accelerators/
  domain/        manifest schema and parse, capability graph (dependencies, waves),
                 preflight (pure: manifest + inventory + mirror facts → report),
                 materialization plan (files to write, patches to apply, conflicts),
                 template validation (mandatory fields, references, CSDM-lite rules)
  application/   list, check, add, load (orchestrate through ports)
  ports.ts       PackSource (read a pack), PackBranch (commit and merge the pack branch),
                 ImportSetWriter (post rows, run transform, read row results)
  index.ts
```

- It uses `kernel` and `metadata` directly and talks to `plugins`, `sync` (mirror reads) and
  `delivery` through their application services only (AGENTS.md).
- `domain/` stays pure: preflight and materialization are functions of their inputs, tested
  with unit and property tests.
- Adapters (in `packages/cli/src/adapters/`, as today): the embedded pack source, the git pack
  branch (reusing the mirror's plumbing writer), and the Import Set writer over the request
  scheduler and `KeysetPager` (ADR-0016) for reading row results.

### 4.2 Packs in the binary

Packs are directories the build embeds as assets, as the agent packs are embedded today. The
build reads the list of pack directories from one place (the build configuration), so a pack
can leave the repository without code changes.

- **NTT DATA packs live in `nttdata/`** at the repository root (P2), for example
  `nttdata/accelerators/itsm/`. The folder is self-contained so it can move to a private
  repository as a whole: nothing outside it imports or references its contents except the build
  configuration's pack list, and nothing inside it references paths outside it. A test enforces
  both directions.
- A test pack lives under `tests/fixtures/accelerators/minimal/` and is never shipped.

### 4.3 Manifest (`accelerator.yaml`)

```yaml
id: itsm
version: 1.0.0
requires: { snagentic: ">=1.8.0" }
scope: x_nttdata_acc            # or a parameter, after S-A (nttdata/accelerators/itsm/)
capabilities:
  foundation:
    wave: 0
    label: "ITSM accelerator: foundation"   # update-set batch label
    plugins:
      - { id: com.snc.cmdb.csdm, minVersion: null, entitlement: free }
      - { id: com.snc.csdm_activation, minVersion: null, entitlement: free }
    data:
      - { entity: company, table: x_nttdata_acc_imp_company, key: [name], after: [] }
      - { entity: location, table: x_nttdata_acc_imp_location, key: [name], after: [company] }
  incident:
    wave: 1
    dependsOn: [foundation]
    plugins: [ ... ]
```

Schema in zod; every rule of the manifest (unique ids, acyclic `dependsOn` and `after`, every
data table delivered by some capability, waves monotonic along dependencies) is a domain test.

### 4.4 Provenance and the gate check

- `accelerator add` commits the pack's files for the chosen capabilities to
  `accelerator/<id>` with git plumbing (never touching the working tree or index), then merges
  that branch into the working branch the way `integrate` merges the mirror. The pack branch's
  commit carries the manifest; this is the record of which file belongs to which capability.
- `plan_push` gains one gate input: for every planned write whose path is on a pack branch,
  the capability's required plugins must be active in the mirror's plugin inventory. If not,
  a `block` finding (`ACC-001: capability <c> requires plugin <id>`), with the hint
  `snagentic plugins activate <instance> <id> --confirm`, then `pull`. It is a gate finding
  like any other, so it can be waived only with a reviewed waiver.
- The pack branch is added to the protected paths (ADR-0011 layer 1).

### 4.5 Use cases (registry)

| Use case | Flags | MCP |
|---|---|---|
| `accelerator list` | readOnly | part of `accelerator` |
| `accelerator check` | readOnly | **`accelerator`** (input: `pack?`, `instance?`, `waves?`, `capabilities?`; no pack → the list) |
| `accelerator add` | not readOnly, not destructive, no instance | CLI only |
| `accelerator load` | destructive, requiresDevelopmentInstance, `confirm` | CLI only |

`load` is **not registered** for test or production instances (ADR-0012), like push.
`MCP_TOOL_BUDGET` becomes 13 and ASR-09 is updated in the same commit.

## 5. Milestones

Each milestone ends green on `bun run verify` and is one or more commits. Live checks are
opt-in (`SNAGENTIC_LIVE_INSTANCE=pdi`).

| # | Milestone | Behaviour tests (examples) | Depends on |
|---|---|---|---|
| M-1 | Flow delivery proven: spikes S11 and S13, **ADR-0028 accepted 2026-10-13, amended 2026-10-14**, every "before track A" test of `flows-test-plan.md` passed or decided (2026-10-14) | `flows-test-plan.md` | – |
| F1 | **Done 2026-10-14: `scripts/build.ts`, `adapters/fluent/`, `doctor` check `fluent`. CI run 38633268745: `doctor` builds the test flow on all four platforms; size 211 MB (macOS) to 276 MB (Linux x64); `--version` p95 on CI 43–106 ms (1.5.x: 166–236 ms); developer machine `check` p95 54 ms vs 121 ms. A6 budget: set from these.** **SDK in the build.** `bun run build` embeds the SDK as a second entry point, bytecode, no identifier minification; the types asset (declarations and every `.json`); the four bundle-time patches each assert their target (A8); SDK version pinned and reported by `doctor` | the release binary builds the eleven `tests/fixtures/fluent` projects equal to their CLI output on four platforms (A1–A4); no network (A7); `check` p95 within ASR-04 (A5); size measured for the budget (A6) | M-1 |
| F2 | **Done 2026-10-14: `validate` builds changed projects under `source/` in a copy; rules SN-MNT-009 (build errors), SN-MNT-010 (commit generated keys), SN-MNT-011 (no deletes), SN-UPG-003 (SDK version); findings carry `root: workspace`.** **Fluent source in the workspace.** `source/<scope>/` configuration projects; `validate` builds them and reports SDK diagnostics as findings (A9); a mismatched SDK version warns (A10); mirrored flow rows stay protected | a Fluent error is a finding with file, line and code; an unknown `package.json` SDK version warns; editing a mirrored flow row is refused | F1 |
| F3 | **Done 2026-10-14 (fakes): plan builds changed configuration projects, lists each flow, subflow, action and record, binds their digest into the plan id, refuses a package-type project and an instance without the publish endpoint; keys and deletes are gate findings (F2).** **Plan.** `plan_push` builds in a copy and refuses when the build would change `keys.ts`; refuses delete records outside the project's own keys; preflight: publishing user's domain, `activate_flows` present, cross-scope privileges declared (B8); the plan shows each flow as one change | each refusal before any write; a flow appears once in the plan with its version | F2 |
| F4 | **Done 2026-10-14, live on pdi2: Fluent source → validate → plan-push → push created the batch, published a flow and an action, captured both by content, the flow ran; a redelivery reused the batch, was inactive 7.4 s, and ran the new version. Gap: no command writes generated keys yet (decision P5).** domain preflight before any write; per scope after its records: load into the batch with `targetUpdateSetId`, publish in one call, capture checked by content; journal; inactive window reported.** **Push.** Select the batch set for the scope, `fluent/load` with `targetUpdateSetId`, `activate_flows`, restore preferences (by user and name); verify capture by content (published, snapshot), moving its own update only; journal with the load's result; report the inactive window and the records that matched it (B3, accepted on development) | fakes: order of calls, restore on failure, never a retry of load or publish, capture failure reported; live (opt-in): B1, B5, B10 rerun through `push` | F3 |
| F5 | **Contract tests done 2026-10-14: `tests/live/fluent-endpoints.test.ts` passes on pdi2 (unknown sys_id → no results; empty lists → 400, so push never sends them; unknown update set → named error). B6 (rename and removal) still to run live.** **Contract and edge tests.** Live contract tests for `fluent/load` and `activate_flows` (B9); rename and removal in source (B6); order (B10) | `tests/live` pass on pdi2 | F4 |
| F6 | **Mostly done 2026-10-14: getting-started "Flows" section; the build skill says flows are written in Fluent under source/<scope>/ and never in mirrored rows. Pending: the keys step (P5), the trigger evaluation (C2e).** **Docs and agent pack.** Commands reference, build skill points to the SDK documentation for flows (C2e), getting-started section on flows | trigger evaluation passes | F4 |
| — | **Release v1.7.0** (flows) | | F1–F6 |
| M0 | Spikes S-A to S-C, results written here; ADR-0026 amended for S-A | – | M-1 (runs alongside track F) |
| M1 | **Done 2026-10-15.** Manifest and capability graph (domain) | rejects a cyclic `dependsOn`; orders data entities by `after`; selects wave 1 with its wave 0 dependencies | M0 |
| M2 | **Done 2026-10-15.** Preflight and `accelerator check` / `list`, MCP tool `accelerator`, budget to 13 | reports "needs plugin" with the exact activate command; reports "blocked" when a patched record is missing; reads no instance beyond the mirror | M1 |
| M3 | **Done 2026-10-15: a record the mirror already holds is written onto its mirrored copy; fields pull redacts are never written, and a patch of one is refused.** Materialization and `accelerator add`, pack branch | writes new records with the pack's sys_ids; applies a patch to the mirrored file only; refuses to overwrite a file the user changed; a second add of the same version changes nothing; never touches the index | M1 |
| M4 | **Done 2026-10-15 as SN-MNT-012.** Gate check `ACC-001` in `plan_push` | blocks a planned write of a capability whose plugin is inactive; passes once the inventory shows it active; waivable | M3 |
| M5 | **Done 2026-10-15 as `accelerator validate-data`.** Template validation and `load --validate-only` | reports a missing mandatory field, an unresolved reference, an offering without a support group; refuses a git-tracked data directory | M1 |
| M6 | **Done 2026-10-15.** Import Set adapter (contract suite, `msw`) and `accelerator load` | loads in `after` order; stops at the first entity with errors; never retries a post; writes no field value to disk or logs; is absent for test and production instances | M5, S-B |
| M7 | **Done 2026-10-15, live on pdi2: check (ready) → add → validate → plan-push → push (app, property, patch captured in one batch) → validate-data → load (2 inserted; refused without `--confirm`) → pull → integrate; second run: add changed no file, plan "nothing to push", load "2 unchanged". Two fixes came out of it (re-add onto mirrored copies; redacted fields). Plugin activation step not exercised: the fixture's plugin was already active.** End to end with the minimal test pack, live on the PDI | check → activate → pull → add → validate → plan_push → push → load, run twice: the second run changes nothing | M2–M6 |
| M8 | Upgrade path | a pack version 1.0.1 that changes one property and removes one record merges with a user edit; the removed record is reported, not deleted | M3 |
| M9 | Docs and agent pack | `docs/reference/commands.md` regenerated; deliver skill gains the accelerator steps; getting-started section | M7 |
| — | **Release v1.8.0** (accelerator mechanism) | | M0–M9 |
| B1 | ITSM pack (`nttdata/accelerators/itsm/`): scoped app, all switch properties, import set tables and transforms for the 9 entities, demo data set | `accelerator check` clean on the PDI; demo load twice, no duplicates | v1.8.0, S-C |
| B2 | Foundation: persona groups and roles, schedules, CSDM-lite demo model | every offering has a support group and a schedule (template validation) | B1 |
| B3 | Incident core: taxonomy, priority, hold reasons, routing chain, notifications, workspace | ATF files plus the browser smoke test of the design | B2 |
| B4 | Incident tasks and parent/child | ATF: children close with parent; resolve blocked by open task | B3 |
| B5 | SLAs and OLAs | ATF: SLA attaches on the offering's schedule; pauses on hold | B3 |
| B6 | On-Call: rota templates, escalation, after-hours trigger, Notify behind an alias | a page reaches the PDI user | B2 |
| B7 | Major Incident: triggers, communication plans, outage and status, auto-problem; Teams behind a channel-neutral step | browser walk-through of the MI path | B3, B6 |
| B8 | Employee Center and knowledge: report an issue, my tickets, status, KBs, 25 articles | browser walk-through as an employee | B2 |
| B9 | AI tier 1: VA topics, recommended actions, PI definitions | VA conversation creates an incident | B3 |

Track B items each ship as a pack version; one branch per capability gives one update set per
capability. Every B item follows the functional design's batch cycle (design, build as files,
validate, review, plan and push, prove, record evidence).

## 6. Safety tests (added to the invariants suite)

- `accelerator load` is absent from the registry for test and production instances.
- `load` refuses without `--confirm`, refuses a git-tracked data directory, and writes no field
  value to its report, logs or errors (counts and business keys of failed rows only).
- `add` never writes outside the workspace's metadata folder and never touches the index or
  working tree of the pack branch.
- No accelerator use case writes metadata to an instance; only `push` does (a registry test
  over the delivery ports each use case receives).
- Import Set requests go through the request scheduler, are never retried, and honour
  cancellation (fake scheduler tests).

## 7. Decisions of the product owner (2026-10-14)

- **P1. Release split: mechanism first.** The accelerator mechanism ships with the minimal test
  pack; ITSM content follows as pack versions.
- **P2. Pack location: this repository, in `nttdata/`.** NTT DATA-specific packs live in a
  self-contained top-level folder that can move to a private repository as a whole (section 4.2).
  Moving it later needs the "packs from a path" option ADR-0026 deferred; nothing in track A
  depends on where packs live, because they are read through `PackSource`.
- **P3. Test pack fixture on the PDI: accepted.** The minimal pack's scratch application
  (`x_<prefix>_snagtest`) stays on pdi2 and is marked inactive after M7. Done 2026-10-15: `x_snagentic_min`
  is inactive on pdi2, with its property and 2 `cmn_location` rows.
- **P4. Flows: their own release first.** Track F ships as v1.7.0; the accelerator mechanism
  follows as v1.8.0. Release 1.6.0 (domains, spec 006) shipped meanwhile, so the plan's earlier
  "v1.5.0" became v1.8.0.

- **P5 (open, 2026-10-14). Writing a Fluent project's generated keys.** validate reports new IDs
  (SN-MNT-010) but nothing in snagentic writes them to `keys.ts`; the live test used the
  runtime directly. *Recommendation: a CLI-only use case, `snagentic fluent-keys <project>`
  (writes only `src/fluent/generated/keys.ts`, no instance, not an MCP tool), named in the
  finding's remediation. Alternative: validate writes it, but validate is read-only and runs in
  the pre-commit hook.*

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| S-A says foreign prefixes fail | Scope differs per instance; moving update sets between instances breaks | Per-instance scope parameter; document that a pack is installed, not moved |
| S-C shows key wave 1 artifacts are records, not metadata (for example SLA definitions or rotas) | More of the pack becomes data, loaded per instance | The load path handles them; the manifest marks them as configuration data, separate from customer data |
| S11 finds no route that meets all four criteria | Flows, and every capability built on them, cannot be delivered | Stop and decide with the product owner before track A; never fall back to a script runner or hand-written compiled rows |
| Pack sys_ids collide with records on a customer instance | Create fails | `check` reads the mirror for every pack sys_id and reports collisions as blocked |
| Big data loads (users, CIs) | Instance load (ASR-16) | Batches through the scheduler, with a row budget per run; large loads run on the instance as scheduled imports |
