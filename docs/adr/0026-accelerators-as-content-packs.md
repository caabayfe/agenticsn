# 0026. Accelerators are versioned content packs, installed through the existing flow

- Status: Accepted (product owner, 2026-10-13); amended 2026-10-14 (pack location, below);
  amended by ADR-0031 (content is Fluent; customizations are adopted, below)
- Date: 2026-10-13
- Requirements: ASR-01, ASR-02, ASR-03, ASR-08, ASR-09, ASR-11, ASR-15, ASR-16; goal G1
- Amends: 0002 (MCP budget 12 → 13), 0010 (adds accelerators to scope)
- Relates to: 0011 (enforcement layers), 0012 (production read-only), 0013 (plugin
  activation), 0019 (engine served through MCP), 0025 (scoped applications from files),
  spec 004 (plan and push)
- Functional design: `specs/005-itsm-accelerator/functional-design.md`

## Context

The ITSM accelerator (spec 005) must install on any development instance: check and activate
plugins, create the scoped application `x_nttdata_acc`, configure out-of-box tables in one
update set per capability, and load foundation data (companies, locations, users, groups,
schedules, services, CIs, rotas, articles). Waves 2 to 4 follow, and other accelerators
(HR, CSM) are likely. Whatever we decide is paid again by every wave and every accelerator,
so it must scale by adding **content**, not code, tools or write paths.

Four forces:

1. **The MCP budget is full.** Twelve tools are registered with `mcp: true`, the budget
   test fails on a thirteenth. The owner decided on 2026-10-06 (spec 003, D1) to raise the
   budget as needed, provided each tool answers a distinct question, amending ADR-0002 when
   the next tool is added. ADR-0002 and ADR-0010 reject **separate MCP servers** outright.
2. **Push is the one write path for metadata**, with its plan id, gate, base hashes, journal
   and capture check (spec 004). A second metadata write path would have to rebuild all of
   that, and would be the weaker one.
3. **Business records.** ASR-08 keeps business records off disk in the **mirror**: pull reads
   only `sys_metadata` and quarantines secrets. Nothing in snagentic writes business records
   to an instance. The accelerator must load them, and the functional design wants the same
   load on dev, test and production, while ADR-0012 forbids snagentic to write to test and
   production.
4. **Plugins are already handled.** `plugins` and `plugin_activate` (ADR-0013) list and
   activate plugins on development instances, confirmed, never retried.

## Decision

### 1. An accelerator is a content pack, not code

A pack is a directory with a manifest, `accelerator.yaml`, and three kinds of content:

```
accelerators/itsm/
  accelerator.yaml          id, version, minimum snagentic version, waves, capabilities
  metadata/<capability>/    record files in the workspace layout (ADR-0014, ADR-0017)
  patches/<capability>/     field changes to out-of-box records, by table and sys_id
  data/<entity>.csv         data templates, plus a fictional demo data set
```

The manifest declares, per capability: the plugins it requires (id, minimum version, whether
the instance may lack the entitlement), the capabilities it depends on, its update-set label,
and its data entities in load order with their business keys and import set table.

- **New records carry fixed sys_ids** chosen by the pack, so every install of a version
  creates the same records and a reinstall or upgrade is an update, not a duplicate.
- **Out-of-box records are patched, never replaced.** A patch names fields and values; it is
  applied to the mirror's copy, so the base hash is the instance's own and the gate sees a
  normal update. A patch whose record is missing on the instance is a preflight problem.
- First-party packs live in `packages/accelerators/<id>/` and ship inside the binary,
  versioned and tested with the engine (ADR-0008, ADR-0019). A pack is validated by a schema
  and by the same rules as any change (`validate`), in CI, before release.
- **Packs are data.** Adding a wave, a capability or a second accelerator adds files to a
  pack, never a use case, a tool or a branch in core.

### 2. Installing is "add files, then the normal flow"

```
accelerator check  → plugins activate → pull → accelerator add → validate → plan_push → push
       ↑ read-only        (existing)     (existing)  (workspace only)  (existing, unchanged gate)
```

1. **`accelerator check <pack> <instance> [--waves]`** (read-only, any instance kind with a
   mirror): reads the manifest against the mirror's plugin inventory (ADR-0016 operational
   data) and the out-of-box records the patches touch, and returns, per capability:
   ready, needs plugins (with the exact `plugins activate` commands), not entitled, or
   blocked (missing record, version too low, domain separation state). It writes nothing.
2. **Plugins** are activated with the existing `plugins activate`, one confirmed call each.
   No new write path, no batch activation.
3. **`accelerator add <pack> [--waves] [--capabilities]`** writes the pack's files into the
   workspace: new records as files, patches applied to mirrored files. It changes nothing on
   the instance. It refuses when the mirror lacks a required plugin's records (run `check`),
   and never overwrites a file the user changed since it was added.
4. **`plan_push` and `push` are unchanged.** One branch per capability gives the one update
   set per capability the design asks for (spec 004, D3). The scoped application is created
   first, as for any new application (ADR-0025).

**Enforcement, not guidance** (ADR-0011): a pack-aware gate check in `plan_push` blocks any
change that belongs to a capability whose required plugins are not active in the mirror. The
skill only tells the agent the order; the gate stops a push in the wrong order.

**Upgrades** reuse git: `accelerator add` commits the pack's files to a pack branch
(`accelerator/<id>`) with plumbing, as pull does for the mirror (ADR-0007), and merges it into
the working branch. A later version is a new commit on that branch, so the customer's edits
and the pack's changes meet as an ordinary three-way merge. Records a version removes are
reported, never deleted (spec 004, D2: deactivate instead).

### 3. Data is loaded through the pack's import sets, on development instances only

Business records are not metadata and never go through plan and push or update sets (as the
functional design already decides).

- The pack's scoped application ships one import set table and transform map per entity,
  coalescing on the entity's business key. They are metadata, delivered by step 2.
- **`accelerator load <pack> <instance> --data <dir>`** (CLI only, development instances only,
  `--confirm`) first validates every template (mandatory fields, references that resolve,
  CSDM-lite rules) and loads nothing until all pass; then, in the manifest's dependency order,
  posts the rows to the import set table through the Import Set API and runs its transform.
  Rows go through the instance's request scheduler and are never retried (ADR-0016). It reports
  inserted, updated, skipped and errored rows per entity from the import set rows.
- **ASR-08 is kept and made precise.** It governs what snagentic **writes to disk**. `load`
  reads data files the user provides and writes nothing to disk but its report, which carries
  counts and business keys of failed rows, never field values. Customer data files must sit
  outside the workspace, or under a path the workspace's `.gitignore` excludes; `load` refuses
  a data directory tracked by git. Only the pack's fictional demo data set is committed.
  Loaded records are not `sys_metadata`, so pull never mirrors them.
- **Test and production are not loaded by snagentic** (ADR-0012, ASR-15). For those,
  `accelerator load --validate-only` checks the templates without an instance, and the
  delivery team runs the same import sets on the instance itself. The design's "same load on
  every instance" holds because the import sets and transforms are the same delivered metadata.

### 4. One read-only MCP tool; writes stay where they are

- **`accelerator`** becomes the 13th MCP tool (amends ADR-0002, under the owner's decision of
  2026-10-06): read-only, it answers "what accelerators exist, and what does installing this
  one need and change on this instance". It returns the `check` report and the ordered next
  commands. Its input is a pack id, an instance and optional waves or capabilities; one tool
  serves every pack and every wave.
- `add` is a workspace write and `load` a business-data write; both start as **CLI only**. The
  agent already reaches the CLI (ASR-01); MCP for either is a separate decision, taken on
  evidence from the task evaluations (spec 003, D4).
- Metadata writes stay in `push`, plugin writes in `plugin_activate`. No accelerator tool can
  write an instance.

## Consequences

- A new wave or accelerator is a pack change, reviewed as files and tested by `validate` and
  pack schema tests; the MCP surface and the write paths stay the same size.
- Install is several commands, not one. An agent follows them from `accelerator`'s output and
  the deliver skill; the gate stops the wrong order.
- New core work: a `accelerators` context (manifest schema, preflight, pack materialization
  into the workspace, pack branch), a gate check for required plugins, an Import Set adapter
  with its contract suite, and a template validator.
- snagentic writes business records for the first time, to development instances only.
  `load` has its own safety tests: refuses non-development instances, refuses git-tracked data,
  writes no values to disk or logs.
- Test and production loads remain a manual, documented step.
- **Open: the vendor prefix.** ADR-0025 requires a new scope to start with the instance's
  vendor prefix. `x_nttdata_acc` exists only on instances whose company code is `nttdata`.
  Either a pack's scope is a parameter resolved per instance (the same pack gets different
  scopes on different instances, which breaks moving update sets between them), or a pack may
  name a foreign prefix, which the platform allows for imported applications but which we have
  not tested through the Table API. A spike on the PDI decides it before the plan is approved.

## Alternatives considered

- **A separate accelerator MCP server.** Rejected: ADR-0002 and ADR-0010 reject multiple MCP
  servers. Hosts load the union of tools, configuration multiplies, and the agent must choose
  between overlapping paths. It also doesn't scale: either each accelerator adds a server, or
  the server's tools grow with every wave.
- **One MCP tool per step or per accelerator** (`accelerator_check`, `accelerator_install`,
  `itsm_*`). Rejected: spends the budget on content, and an install tool would be a second
  write path beside `push`.
- **A single `accelerator install` that activates, pushes and loads.** Rejected: it would
  duplicate the gate, journal and capture checks of push, hide three distinct approvals behind
  one, and mix metadata with business data in one transaction.
- **Data as update sets or pushed records.** Rejected: business records would enter the plan,
  the gate and git, against ASR-08 and the functional design ("data never travels in update
  sets").
- **Packs as scripts run on the instance** (fix scripts, background scripts). Rejected: not
  reviewable as files, not governed by the gate, and a script runner is a write path snagentic
  must never have for test and production (AGENTS.md safety invariants).
- **Packs outside the binary (downloaded at run time).** Deferred: a customer or partner pack
  ecosystem is plausible (ASR-11), but needs signing and a trust decision. The manifest format
  is designed so a pack directory can later come from a path or registry without change.

## Amendment (2026-10-14, product owner, spec 005 decision P2)

Pack location. Generic first-party packs live in `packages/accelerators/<id>/` as decided above.
**NTT DATA-specific packs live in `nttdata/` at the repository root** (the ITSM pack:
`nttdata/accelerators/itsm/`), still embedded in the binary. The folder is self-contained so it
can move to a private repository as a whole: nothing outside it references its contents except
the build's list of pack directories, and nothing inside it references paths outside it; a test
enforces both. Moving it out later needs packs from a path, which this ADR deferred.

## Amendment (ADR-0031)

All authoring moved to ServiceNow Fluent, and the mirror became read-only (ADR-0031). A pack's
content follows: it no longer ships records in the mirror's layout or patches to mirrored
records.

```
accelerator.yaml                  manifest: capabilities, waves, plugins, data (unchanged)
source/<capability>/<scope>/...   Fluent project files, copied to the workspace's source/<scope>/
adopt/<capability>.yaml           out-of-box records the capability customizes: a list of
                                  { table, sys_id, note }, the note saying what to change
data/<entity>.csv                 data templates (unchanged)
```

- `accelerator add` copies the selected capabilities' source into the workspace's projects, on
  the pack branch as before, and lists the records to adopt as next steps: the user runs
  `adopt` on each, then makes the change its note describes, in Fluent. Customizations are
  edits to adopted source, reviewed and gated like any other; snagentic never writes a field
  of an out-of-box record on its own.
- The gate's check (SN-MNT-012) works per project: a project with planned units that a
  capability ships files into, while that capability is not ready, is blocked.
- A pack still holding `metadata/` or `patches/` (format 1) is refused with the new layout as
  the remedy. Nothing was converted: the only pack was a test fixture.

## Amendment (ADR-0038, proposed 2026-10-18)

Product owner decisions of 2026-10-18, recorded in ADR-0038:

- **No pack scope.** A customization lives in the scope that owns its target, global or an
  application's scope. A module holds one Fluent project per scope it touches and is delivered as
  one parent update set with one child per scope. The open vendor-prefix item above no longer
  blocks packs.
- **Capabilities are modules**, which declare platform components (plugins and store
  applications), and packs name **profiles** (sets of modules).
- **`accelerator install`** replaces the rejected "single install" alternative: it runs the
  existing steps from one plan the platform admin approves by id, and resumes by re-running.
- **Test and production** get the components only, at parity with development, installed
  automatically with a separate installer credential. Update sets and data stay as decided above.
