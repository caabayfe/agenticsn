# 005. ITSM accelerator: plan

- Status: Draft, for the product owner's review
- Date: 2026-10-13
- Implements: ADR-0026 (accelerators as content packs)
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
| **B. Content** | The ITSM pack: wave 0 and wave 1 | `packages/accelerators/itsm/` | Files, validated by the pack tests and `validate` |

Track A ships first, proven with a **minimal test pack** (one scoped application, one property,
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
| S-A | **Vendor prefix.** Can the Table API create `x_nttdata_acc` on an instance whose company code is not `nttdata`? Does an update set holding it then move to another instance? | ADR-0026 open item: fixed scope (if yes) or a per-instance scope parameter (if no). Recorded as an amendment to ADR-0026 | PDI: create `sys_app` with a foreign prefix through push's write path; export its update set; preview on a second PDI |
| S-B | **Import Set API.** `POST /api/now/import/<table>` and `insertMultiple`: is the transform synchronous, what does each row report, how does coalescing behave on re-run, which roles does it need? | Load adapter design and its contract suite | PDI, scratch import set table, two runs of the same 20 rows |
| S-C | **What is metadata.** For every artifact type wave 0 and 1 need (SLA definitions, schedules, rotas, assignment rules and data lookups, notifications, inbound actions, record producers, knowledge bases, VA topics, workspace configuration, PI definitions), is it `sys_metadata` (push) or a record (load)? | The pack's split between `metadata/`, `patches/` and `data/` | Query `sys_db_object` hierarchy on the PDI; recorded as a table in this spec |
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

`packages/accelerators/<id>/` holds pack directories. The build embeds them as assets, as the
agent packs are embedded today. A test pack lives under `tests/fixtures/accelerators/minimal/`
and is never shipped.

### 4.3 Manifest (`accelerator.yaml`)

```yaml
id: itsm
version: 1.0.0
requires: { snagentic: ">=1.5.0" }
scope: x_nttdata_acc            # or a parameter, after S-A
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
| M-1 | Flow delivery: spikes S11 and S13 done, **ADR-0028 accepted 2026-10-13**. Remaining: the "before track A" tests of `flows-test-plan.md` | `flows-test-plan.md` | – |
| M0 | Spikes S-A to S-C, results written here; ADR-0026 amended for S-A | – | M-1 |
| M1 | Manifest and capability graph (domain) | rejects a cyclic `dependsOn`; orders data entities by `after`; selects wave 1 with its wave 0 dependencies | M0 |
| M2 | Preflight and `accelerator check` / `list`, MCP tool `accelerator`, budget to 13 | reports "needs plugin" with the exact activate command; reports "blocked" when a patched record is missing; reads no instance beyond the mirror | M1 |
| M3 | Materialization and `accelerator add`, pack branch | writes new records with the pack's sys_ids; applies a patch to the mirrored file only; refuses to overwrite a file the user changed; a second add of the same version changes nothing; never touches the index | M1 |
| M4 | Gate check `ACC-001` in `plan_push` | blocks a planned write of a capability whose plugin is inactive; passes once the inventory shows it active; waivable | M3 |
| M5 | Template validation and `load --validate-only` | reports a missing mandatory field, an unresolved reference, an offering without a support group; refuses a git-tracked data directory | M1 |
| M6 | Import Set adapter (contract suite, `msw`) and `accelerator load` | loads in `after` order; stops at the first entity with errors; never retries a post; writes no field value to disk or logs; is absent for test and production instances | M5, S-B |
| M7 | End to end with the minimal test pack, live on the PDI | check → activate → pull → add → validate → plan_push → push → load, run twice: the second run changes nothing | M2–M6 |
| M8 | Upgrade path | a pack version 1.0.1 that changes one property and removes one record merges with a user edit; the removed record is reported, not deleted | M3 |
| M9 | Docs and agent pack | `docs/reference/commands.md` regenerated; deliver skill gains the accelerator steps; getting-started section | M7 |
| — | **Release v1.5.0** (mechanism) | | M0–M9 |
| B1 | ITSM pack: scoped app, all switch properties, import set tables and transforms for the 9 entities, demo data set | `accelerator check` clean on the PDI; demo load twice, no duplicates | v1.5.0, S-C |
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

## 7. Decisions for the product owner

- **P1. Release split.** Mechanism as v1.5.0 with the minimal test pack, ITSM content after.
  *Recommendation: yes; it proves the path before the content depends on it.*
- **P2. Pack location.** First-party packs in this repository (`packages/accelerators/`). The
  ITSM pack is NTT DATA-specific (`x_nttdata_acc`); if it must not ship in the public binary,
  it lives in a private repository and needs the "packs from a path" option ADR-0026 deferred.
  *Recommendation: decide before B1; it changes nothing in track A if packs are read through
  `PackSource`.*
- **P3. Test pack fixture on the PDI.** The minimal pack creates a scratch application
  (`x_<prefix>_snagtest`) on pdi2, which stays there. *Recommendation: accept; mark it inactive
  after M7.*

## 8. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| S-A says foreign prefixes fail | Scope differs per instance; moving update sets between instances breaks | Per-instance scope parameter; document that a pack is installed, not moved |
| S-C shows key wave 1 artifacts are records, not metadata (for example SLA definitions or rotas) | More of the pack becomes data, loaded per instance | The load path handles them; the manifest marks them as configuration data, separate from customer data |
| S11 finds no route that meets all four criteria | Flows, and every capability built on them, cannot be delivered | Stop and decide with the product owner before track A; never fall back to a script runner or hand-written compiled rows |
| Pack sys_ids collide with records on a customer instance | Create fails | `check` reads the mirror for every pack sys_id and reports collisions as blocked |
| Big data loads (users, CIs) | Instance load (ASR-16) | Batches through the scheduler, with a row budget per run; large loads run on the instance as scheduled imports |
