# 008. Fluent as the only way to author changes: architecture and migration plan

- Status: Proposed, for the product owner's review
- Date: 2026-10-16
- Decisions: ADR-0031, ADR-0032 and ADR-0033, all accepted 2026-10-16. Spike S17 done (M0)
- Evidence: `analysis.md` (this folder), spike S16 (`tools/spikes/s16-fluent-authoring/README.md`)
- Requirements: G1, G3, ASR-01, ASR-02, ASR-03, ASR-04, ASR-09, ASR-13, ASR-16
- Release: 2.0.0. The workspace format changes. Nobody uses snagentic yet (product owner,
  2026-10-16), so there is **no migration command and no dual mode**: layout 1 workspaces are
  refused with "re-create the workspace".

## 1. Principles

Each principle is enforced in code, not only described.

1. **One authoring format, one write route.** Developers and agents edit only Fluent source. Every
   write is a `fluent/load` of what the SDK built, into the batch's update set. snagentic writes
   no ServiceNow record format of its own.
2. **The mirror is the truth about the instance, and nothing else.** Only pull writes it. An edit
   under `instances/*/metadata` is refused by `check`, the hooks and the gate.
3. **The SDK never talks to an instance on its own** (ADR-0032). It runs inside snagentic's
   process with a connector snagentic provides:
   - every request goes through the instance's request scheduler (ADR-0016);
   - the credential stays in snagentic's process;
   - only an allow-list of read routes passes, so the SDK cannot write.
4. **A plan is the effect on the instance** (ADR-0033). It is the built records compared with the
   mirror, field by field, not a diff of source files. What the plan lists is exactly what the
   load changes, including side effects the developer didn't write.
5. **Instance edits are never overwritten silently.** Each owned record has a base in a committed
   ledger. A record whose instance copy moved away from its base is drift. Plan refuses it until
   `adopt --refresh` has brought the change into git.
6. **Deletion is explicit.** Only `Now.del` deletes. A definition removed without one is a
   blocking finding.

## 2. Target architecture

### Workspace (layout 2)

```
snagentic.yaml                    layout: 2
waivers.yaml                      paths may name source files or records (table:sys_id)
source/<scope>/                   one Fluent `configuration` project per scope, global included
  now.config.json                 scope, scopeId, type "configuration"
  package.json                    the SDK version snagentic embeds (SN-UPG-003)
  src/fluent/**/*.now.ts          definitions; scripts in Now.include files
  src/fluent/generated/keys.ts    $id -> sys_id, written by the pre-commit hook
  snagentic.ledger.yaml           per instance: owned records and their base (ADR-0033)
instances/<name>/...              the mirror: unchanged format, read-only
```

`init` scaffolds `source/global`. `adopt` scaffolds a scoped project the first time it adopts a
record of that scope.

### Bounded contexts

| Context | Role after the migration | Change |
|---|---|---|
| `sync` | Pull and the mirror: the read model | Unchanged, except integrate (below) |
| `knowledge`, `advice` | Find, describe, advise, over the mirror | Unchanged |
| **`authoring`** (new) | Source projects, the build, adopt and refresh, the ledger, equivalence | New. Holds what is generic about Fluent; delivery and governance consume it |
| `delivery` | Plan and push: effect diff, load per scope, stamp, publish, capture, journal | Rewritten around built records |
| `governance` | Validate and the gate, over built records and source scripts | Inputs change; rules are kept |
| `accelerators` | Packs of Fluent source plus CSV data | Content format changes |
| `workspace` | Layout 2, protected paths, init | Small changes |

### The `authoring` context

**Domain (pure):**

- `BuiltRecord`: table, sys_id, action (`INSERT_OR_UPDATE` or `DELETE`), update name, fields,
  child rows, the built file that carries it, and its project.
- `normalize`: makes a built record comparable with a mirrored one. It covers:
  - ignored platform fields (provenance and `sys_*` bookkeeping);
  - natural keys for children the platform matches by content: dictionary, choices, form
    elements, labels;
  - layouts compared as ordered element lists, so `Form()`'s columns equal the mirror's
    `.begin_split` rows;
  - named-view placeholder sys_ids resolved by view name;
  - gzip payloads opened; SBOM serial numbers and timestamps removed.

  It is seeded from S16's `compare.ts`, and every rule is proven by a golden fixture.
- `equivalence`: compares a normalized pair. Each field difference is one of:
  - `same`;
  - `authored`;
  - a **known SDK loss**, a named catalogue tied to the SDK version (S16: a choice's domain,
    licensing configs, references written as display values, API defaults);
  - `unexplained`.
- `Ledger`: per instance, the records a project owns and their base: the mirror hash when the
  record was adopted, refreshed or confirmed after a push.
- `classify(base build, head build, mirror, ledger)`: sorts each field into authored, drift,
  residue (a known loss already present at adoption), or deletion. Plan and the gate both use it.

**Ports:**

| Port | Methods | Adapter |
|---|---|---|
| `FluentToolchain` | `build(project, from: tree \| index \| commit)`, `transform(project, records, connector)` | In-process SDK (exists for builds: `sdk-runtime.ts`, `build-in-copy.ts`) |
| `SourceProjects` | `list`, `scaffold(scope)`, `changedSince(commit)`, `read/writeLedger`, `writeKeys` | Git and filesystem (exists in part: `workspace-fluent-projects.ts`) |
| `InstanceConnector` | the SDK's `IConnector` | **New**: over `ServiceNowClient`, with the read allow-list (ADR-0032) |

**Application:**

- `adopt(records | query)`. It needs a development instance, because the ledger base is per
  instance. Steps:
  1. Resolve the records from the mirror.
  2. Transform them through the connector.
  3. Build.
  4. Check equivalence with the mirror. Any `unexplained` difference refuses with the field
     list; known losses are listed.
  5. Write the source and the ledger entries.

  The result is one reviewable change.
- `refresh(records)` (`adopt --refresh`):
  1. On a temporary branch from the commit where the record's base was set, re-transform the
     drifted records and commit.
  2. Merge that branch into the working branch.

  Git then resolves local and instance edits as in S16 F4. Conflicts are ordinary git
  conflicts, in TypeScript.
- `buildChanged(commit)`: builds the projects changed since a commit, at both ends. The base
  build is cached by commit under `.snagentic/`.

### Delivery

**Plan:**

1. The checks kept from today:
   - the mirror is fresh and integrated;
   - no unfinished push;
   - collisions with other update sets;
   - the gate.
2. Build the changed projects at the merge base and at head.
3. For every record in the head build, plus every record that was in the base build, classify
   against the mirror and the ledger:
   - authored fields: the change;
   - **drift: refuse**, naming `adopt --refresh`;
   - residues: listed as "the load also sets", and waivable;
   - deletions: from `Now.del`.
4. The load set is the built files holding at least one record with an effective difference. A
   record that already equals the instance isn't loaded.
5. The plan id covers:
   - the mirror commit;
   - each record's identity and base hash;
   - a digest of each changed field;
   - the normalized digest of each loaded file;
   - the gate.

**Push:**

| Step | Kept from today | New or changed |
|---|---|---|
| Preflight | Confirm, journal recovery, plan id recomputed, PR | — |
| Update sets | Batch, child set per scope, preference switch and restore | — |
| Base check | — | Per record, the instance's current hash against the ledger base. This replaces three mechanisms: the YAML hash, child-row versions and layout versions |
| Load | — | One `fluent/load` per scope, with the load set, the stamp (`sys_mod_count + 1`, `sys_updated_on`: ADR-0030 item 5) and journal steps before and after |
| Flows | Publish and its capture check | — |
| Capture | `captured` in the target set | One check per update name |
| After | — | The journal records what was loaded, so the next integrate can confirm it |

**Removed (about 2,300 lines plus their tests):**

- the Table API writer, `change.ts`, `child-rows.ts` and `write-order.ts` ranking;
- `plan-routes.ts`, `recording.ts` and the dictionary reads;
- every Table API write of metadata. The Table API stays for session bookkeeping only: update
  sets, preferences, and moving an update between sets (S17 G2);
- the layout writers, about 1,000 lines;
- `record-update.ts`;
- the elevated session and the browser sign-in (ADR-0024), plus the ACL elevation checks.

The import-set writer stays, for accelerators' CSV data.

### Governance

- **Record rules** (SN-MNT-006, the ACL checks, privileges) run on `BuiltRecord` fields. Same
  shape as today: class, scope, fields.
- **Script rules** (the 22 in `rules-basic`) run on each built script field, with the record
  context (`settings.servicenow`). Findings point to the `Now.include` file and line. An inline
  script points to the `.now.ts` file. `adopt` always writes scripts as include files.
- The existing Fluent findings stay:
  - SN-UPG-003, SDK version;
  - SN-MNT-009, build error;
  - SN-MNT-010, keys not committed;
  - SN-MNT-011, the build deletes a record.
- **New findings** (IDs assigned when written; never reused):
  - a definition removed without `Now.del` (block);
  - an `unexplained` difference against the mirror (block);
  - a residue the developer didn't write (warn, waivable);
  - a create in a domain-separated instance without `$override.sys_domain` (block, carries
    ADR-0027);
  - an edit under `instances/*/metadata` (block).
- **Waivers** may name `source/<scope>/**` paths or a record identity.
- **`check`** (the edit hook, ASR-04 under 300 ms): refuses mirror edits. It runs the script
  rules on the edited include file and a TypeScript syntax check on `.now.ts`. It never builds;
  `validate` and the stop hook do.

### Sync and integrate

- **Integrate** becomes a merge that cannot conflict, because nobody edits the mirror. Then it:
  - **confirms pushes:** for each record in the journal whose mirror copy now equals its build,
    it advances the ledger base;
  - **reports drift:** owned records whose mirror copy moved away from their base.

  Both are written in one commit.
- **Removed** (about 600 lines): `takeConfirmed`, `takeRelocated`, `takeReplaced` and the
  related-list pairing, `takeConfirmedRows`, `confirmed-record.ts`, and `replaced-records.ts`
  in integrate. Pull's own handling of replaced related lists stays, because the mirror must
  still be right.
- **Removed**: `EDITABLE_CHILD_TABLES` and the YAML protected paths. The whole mirror becomes
  protected.

### Agent interface

- **Use cases:**
  - `adopt`, a new MCP tool;
  - `plan_push`, `push` and `validate` keep their names;
  - `fluent-keys` stays hook-only.
- **MCP budget** (13, already full): merge `plugins_list` and `plugins_activate` into one
  `plugins` tool, as update sets already are. That frees the slot for `adopt`.
- **Build skill:** find in the mirror, `adopt`, edit Fluent, `validate`, `plan_push`. It points
  agents to the embedded `now-sdk explain` for API reference.
- **Hooks:** deny edits under `instances/*/metadata/**`; allow `source/**`.
- **Instructions:** describe the mirror as read-only context.

### Accelerators

A pack becomes:

- `source/<scope>/` Fluent definitions, for new records;
- adopt lists of out-of-box records it customizes, with the change as Fluent edits;
- CSV data, unchanged.

`accelerator add` copies the source into the workspace and adopts the listed records. The only
pack today is a test fixture, so nothing needs converting.

## 3. ADRs

| ADR | Action |
|---|---|
| 0031 | Accepted 2026-10-16 |
| **0032** (new) | The SDK runs in-process behind snagentic's connector. Proposed; spike S17 decides |
| **0033** (new) | Plans compare the build with the instance; the ledger and drift. Proposed |
| 0024 | Superseded by 0031 once M2 ships: no elevated session |
| 0025 | Superseded: no editable child rows |
| 0029, 0030 | Writers replaced. Platform findings kept (stamping, domain queries, related-list replacement) |
| 0017, 0014, 0007 | Amended: the mirror is read-only; `source/` joins the layout |
| 0026 | Amended: accelerator content is Fluent |
| 0002, 0010 | Amended: `adopt` in scope and in the MCP budget, plugin tools merged |

## 4. Spike S17 (pdi2, before M1): done

Results are in `tools/spikes/s17-sdk-connector/README.md`:

- **G1 passed:** 137 records, 5 requests, one read route.
- **G2 passed:** a new application is a `Record('sys_app')` in the global project.
- **G3:** source is stable on refresh; `keys.ts` toggles `deleted` flags.
- **G4:** store applications are refused in 2.0.
- **G5:** a build takes 3 s.
- **Found:** one stale mirror record fails a whole transform batch, so `adopt` checks that its
  records exist first.

The questions as planned:

| # | Question | Decides |
|---|---|---|
| G1 | Does `transform --table --id` run in-process with our `IConnector`? Which routes does it call, how many requests does one record take, and what does it read for a table with many children? | ADR-0032; the allow-list; the adopt budget (ASR-16) |
| G2 | How is a new scoped application created with no Table API write? Options: the app creator routes the SDK's `init` uses, or a `sys_app` in a `configuration` load | The `app create` route |
| G3 | Form designer edit, then pull, then refresh: is the `Form()` diff small? | Refresh of layouts (open since S16) |
| G4 | Customizing a record of another scoped application (a store app): does the load record a customization in that scope? | Whether adopt refuses those records in 2.0 |
| G5 | Build time for the Access Review application (233 records) at both ends, cold and cached | The plan latency budget, and whether the base build cache is needed |

## 5. Milestones

Each milestone ends with `bun run verify` green and a merged pull request. Main stays releasable:
the new path lands next to the old one, and M2 removes the old one in the same change that
switches push over.

| Milestone | Delivers | Size |
|---|---|---|
| **M0** | S17; ADR-0032 and ADR-0033 decided; ADR amendments drafted | 2 days |
| **M1 Authoring** | The `authoring` context: `BuiltRecord`, `normalize` with golden fixtures from S16, `equivalence` with the loss catalogue, the ledger, `classify`. The `InstanceConnector` with the allow-list. `adopt` and `adopt --refresh`. Layout 2 and `init` scaffolding | 5 days |
| **M2 Plan and push** | The effect plan; drift refusal; plan id material; load per scope with stamping and capture; the journal for loads; flows unchanged. **Removes** the Table API write path, the layout writers, routing and elevation | 5 days |
| **M3 Guardrails** | Validate on built records and source scripts; the new findings; waivers on source; `check` and the hooks for the read-only mirror | 3 days |
| **M4 Integrate** | Integrate as merge, then confirm, then drift report; removal of the merge fix-ups | 2 days |
| **M5 Agents and packs** | Build and deliver skills, instructions, hooks, docs (getting started, the generated command reference); the MCP slot (plugin tools merged, `adopt` exposed); accelerators as Fluent packs; agent evaluations before and after | 4 days |
| **M6 Live and release** | `tests/live` round trip on pdi2: adopt, edit, plan, push, pull, integrate, refresh, delete. Runs on each SDK upgrade. Then the ADR-0030 matrix rebuilt from source, and the Access Review application adopted whole. F5 (second instance) if one is available. Release 2.0.0 | 3 days |

Order matters: M1's `normalize` and `equivalence` are the foundation. Every later check is only
as good as their fixtures, so they get property tests (the normalize round trip, and that the
order of children doesn't matter) as well as goldens.

## 6. Risks

| Risk | Mitigation |
|---|---|
| The SDK's internal `IConnector` or `Orchestrator` API changes between releases | The pinned SDK; one adapter file; a contract test on every upgrade. Fallback: fetch the XML ourselves and `transform --from` offline |
| `normalize` misses a platform equivalence, so plans show phantom changes | Goldens from real instances (S16's data); `unexplained` refuses instead of loading; each new case becomes a fixture |
| Build latency makes plan and validate slow | Build only changed projects; cache the base build by commit; `check` never builds. S17 G5 measures it |
| Agents write poor Fluent | ServiceNow trains its agents on it; `now-sdk explain`; evaluations in M5 |
| Store-app customizations don't record | S17 G4; refused in 2.0 if so, with a hint |
