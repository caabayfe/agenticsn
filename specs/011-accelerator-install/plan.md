# 011. Accelerator install and the ITSM baseline: plan

- Status: Draft (2026-10-18). Decisions D1–D9 taken by the product owner (2026-10-18); O4 and O6 open
- Date: 2026-10-18
- Decision: ADR-0038 (proposed), amending ADR-0026 and ADR-0012
- Builds on: spec 005 (accelerator mechanism, v1.8.0), ADR-0031 (Fluent authoring), ADR-0033
  (plans compare the build with the instance)
- Functional design: `specs/005-itsm-accelerator/functional-design.md`. Its packaging section
  (a scoped app `x_nttdata_acc`) is superseded by D1.

## 1. Goal

One approved command turns a fresh development instance into a top-quality ITSM baseline, module
by module, and can rebuild it from zero at any time. The same command installs the platform
components those modules need on UAT and production, at parity with development. Every module is
documented with its data flows, and its demo master data loads from CSV files.

## 2. Where we start

- The mechanism (manifest, `check`, `add`, gate rule SN-MNT-012, `validate-data`, `load`) is on
  main since v1.8.0 and was moved to Fluent in 2.0 (`dfedbd4`). **On the Fluent route it has only
  run against fakes**: the live end-to-end run (spec 005, M7) used the YAML route.
- Plugin activation follows the CI/CD progress record (poll 5 s, up to 45 minutes). Store
  applications are not handled.
- No pack content exists; `nttdata/` was never created.
- SDK 4.13.6 has typed APIs for most of what the modules need: `ImportSet`, `Sla`, `DataLookup`,
  `CatalogItem`, `VariableSet`, `CatalogItemRecordProducer`, `CatalogUiPolicy`,
  `CatalogClientScript`, `EmailNotification`, `InboundEmailAction`, `StateModel`, `Workspace`,
  flows with approval steps, `Test` and `TestSuite`. Catalogs and categories (`sc_catalog`,
  `sc_category`) are metadata without a typed API, through `Record()`.

## 3. Decisions

### Taken (product owner, 2026-10-18)

| # | Decision |
|---|---|
| D1 | No pack scope. Each customization lives in the scope that owns its target: global, or an application's scope such as On-Call's |
| D2 | One install, from a plan written for the platform admin and approved by its id |
| D3 | Store applications install through the platform's installation mechanism, like plugins, never as a manual step |
| D4 | Components (plugins, store applications) never travel in update sets and install automatically on every instance kind, UAT and production included, with a separate installer credential. Customizations travel in update sets, promoted by the standard mechanism. Data on UAT and production is loaded there by the delivery team |
| D5 | The baseline instance is **not domain-separated**, like most clients: a dedicated instance (not pdi2, where spikes write), rebuilt from zero at each minor pack release. Domain separation is a supported variant for the few clients that use it, proven on a domain-separated instance (pdi2: TOP > Default) with the `demo-full` profile and two demo accounts, at each minor release |
| D6 | Packs live in a private repository, `ntt-accelerators` (locally `../ntt-accelerators`), loaded from a path (`snagentic.yaml` `accelerators.paths`). snagentic keeps only the minimal test pack; `nttdata/` is dropped from the pack roots |
| D7 | **Anchor records**: rows the pack owns carry a fixed sys_id in the CSV, set on insert and matched on re-run. Metadata may reference only anchors; customer-specific references live in data |
| D8 | Module order: Foundation, Incident, Request and catalogs, Problem, Change, then Major Incident and On-Call. Those two must work without Twilio or Teams credentials (email, push and the On-Call mobile app); voice, SMS and the Teams bridge are optional parts behind aliases, reported as "not configured", never blocking an install |
| D9 | Per-account metadata on domain-separated instances is generated per account from a workspace accounts list (section 4.5, item 3), after spike S-H; until then, per-account variation is data only |

### Open

| # | Question | Recommendation |
|---|---|---|
| O4 | Where ATF suites run | From the pack repository's CI through the CI/CD API; a snagentic command only with its own ADR (spec 004, D1) |
| O6 | The demo catalog | Three catalogs and about 15 items (section 7, phase 3) |

## 4. How it works

### 4.1 The pack

```
itsm/
  accelerator.yaml          id, version, requires (snagentic, SDK), tested platform releases,
                            profiles
  README.md                 process → module map and the overall data flow (generated index)
  modules/
    <module>/
      module.yaml           dependsOn, components, data entities and load order
      README.md             the module sheet (4.2)
      source/global/...     Fluent configuration project per scope the module touches
      source/<scope>/...
      data/demo/<entity>.csv  fictional master data, committed
```

```yaml
# modules/on-call/module.yaml (illustrative)
id: on-call
dependsOn: [foundation]
components:
  - { kind: plugin, id: com.snc.on_call_rotation, minVersion: null, entitlement: free }
data:
  - { entity: rota, table: u_acc_imp_rota, key: [name], after: [group, schedule] }
```

```yaml
# accelerator.yaml, profiles (illustrative)
profiles:
  core: [foundation]
  incident: [foundation, incident-core, incident-tasks, incident-sla]
  request-demo: [foundation, request, catalog-it, catalog-people, catalog-workplace]
  demo-full: [ ... every module ... ]
```

### 4.2 The module sheet

Every `modules/<module>/README.md` follows one template:

1. **Purpose**: the process steps the module covers, and what it leaves out.
2. **Data flow**: a Mermaid diagram from channel to record, routing, SLA, notification and
   closure, naming the tables.
3. **Switches**: the properties and the variations each supports.
4. **Components**: plugins and store applications, and why.
5. **Delivered** *(generated)*: records by scope and type; out-of-box records changed.
6. **Data** *(generated)*: entities, keys, load order.
7. **Demo storyline**: the walk-through that proves it, as a numbered script.

Generated sections are rebuilt from the module's build; a pack test fails when they are stale.
The sheets can be published on the documentation site (spec 010).

### 4.3 The install

```
snagentic accelerator install itsm baseline --profile request-demo            # writes the plan
snagentic accelerator install itsm baseline --profile request-demo --confirm <plan-id>
snagentic accelerator install itsm uat --profile request-demo --components-only --confirm <plan-id>
```

On development: plan, components, pull, then per module `add`, `validate`, `plan_push`, `push`
and a commit, then data, then pull and the install report (ADR-0038, section 2). On test and
production: components only, at parity with the development install's journal (ADR-0038,
section 5).

Resume is a re-run of the same command. Each step is idempotent, and nothing is resent after a
timeout without reading the instance first.

### 4.4 Master data

- `modules/<module>/data/demo/*.csv` is the demo set; customer data stays outside git
  (`--data <dir>`). The rule that refuses a git-tracked data directory gains one exception: the
  pack's own demo set, read from the pack.
- Each entity has an import set table and transform map in the module's Fluent source
  (`u_acc_imp_<entity>`, global), coalescing on its business key or, for anchors, on sys_id.
- All templates are validated before any row is loaded; rows load in dependency order across
  modules and are reported per entity: inserted, updated, unchanged, failed.

### 4.5 Domain-separated instances

What Fluent does with domains (evidence: ADR-0027, spec 008 analysis and spike S16 F3, spec 009
analysis X9):

- A Fluent project has no domain model. A record carries a domain only through
  `$override: { sys_domain }` (and `List({ domain })` for list layouts). Without it the record has
  no domain in the build, and the instance places it, in global as far as we have seen.
- Updating a record in place in a non-global domain works (S16 F3). **Creating** a record in a
  child domain, and creating a domain override of a global record (`sys_overrides`), through
  `fluent/load` is not proven yet (spec 009, S19 item 12).
- Choices have no domain at the choice level: Default-domain choices lose it, and choices that
  override another domain's value are dropped (S16). Domain-specific choices are refused in 2.x.
- ACLs, script includes, roles and properties are not domain-separated. UI actions, UI policies,
  inbound actions, menus, notifications, SLA definitions, assignment rules and flows carry
  `sys_domain`. A flow is published only by a user in its domain (S11; the plan checks it).
- pdi2 is domain-separated (TOP > Default), so this is testable there.

How the accelerator uses it. Most clients are not domain-separated (D5): on their instances every
record is in global and items 2 to 5 reduce to nothing. The rules below make the same pack work on
the few that are:

1. **Process logic is global**, so it runs for every domain below. Most modules ship nothing else.
2. **What differs per account is data first**: an offering's support group and schedule, SLA
   targets, rotas. Data rows carry their account's domain, which the transform sets explicitly
   from a `domain` column; a load never relies on the session's domain.
3. **Per-account metadata** (an SLA definition, a notification or an assignment rule that only one
   account has) states its domain with `$override.sys_domain`; a variant of a global record is a
   domain override (`sys_overrides`). Generated per account from an accounts list in the
   workspace, not the pack, with stable keys per account (`Now.ID['sla-p1-' + account]`).
4. **Domains themselves are data**: provider and account domains load first (entity `domain`).
5. **The install plan shows the domain of every record it creates**, and on a domain-separated
   instance the gate blocks a created record in a domain-separated class that doesn't state one.

## 5. Spikes

| # | Question | Decides | How |
|---|---|---|---|
| S-D | Can an import set transform set a fixed sys_id on insert and coalesce on it, from a Fluent `ImportSet`? | D7 (how anchors are loaded) | pdi2: one entity, three rows, two loads; rename one row between loads |
| S-E | Can a Fluent configuration project load into a ServiceNow-owned scope (On-Call), captured in that scope's child update set? Which application access settings refuse it? | D1, the scope gate rule | pdi2: one property or form change in the On-Call scope, through `push` |
| S-F | Which CI/CD API installs a store application, with which roles, how is progress reported, and what does it do with dependencies and demo data? | D3, the component installer | pdi2: install one small store application not yet present |
| S-H | On pdi2 (TOP > Default): create through `fluent/load` (a) a notification in Default, (b) a domain override of a global business rule, (c) an SLA definition in Default; are they created in that domain and captured with it? Does an import set row land in the domain its `domain` column names? | Section 4.5, items 2 and 3 | pdi2, one scratch batch, rolled back |
| S-G | M7 again, on the Fluent route: the minimal pack, check → add → validate → plan_push → push → load, twice | That the mechanism works on 2.x before content | pdi2 |

## 6. Milestones: mechanism (snagentic)

Each milestone ends green on `bun run verify`.

| # | Milestone | Behaviour tests (examples) | Depends on |
|---|---|---|---|
| I0 | Spikes S-D to S-H, results written here; ADR-0038 accepted | – | – |
| I1 | Modules, components and profiles in the manifest; packs from a path (D6), `nttdata/` removed from `pack-roots.ts` and its isolation test | a profile adds its modules' dependencies; a store application is a component; a pack requiring another SDK version warns | I0 |
| I2 | Scope gate rule | a record in a scope that doesn't own its table blocks; a create the application access refuses blocks | S-E |
| I3 | Store application installer beside the plugin activator, one component step | an unknown progress after a lost response is read, never re-requested; demo data never requested; a component past its budget is reported, the run stops, a re-run resumes | S-F |
| I4 | Install plan and plan id | the plan lists every component, module update set, changed out-of-box record and data entity; a changed instance fact changes the id; `--confirm` with another id refuses | I1 |
| I5 | Install orchestrator, journal and lock, on development | runs the steps in order through the existing services; a re-run after a failure at any step skips what is done; a second install on the same instance refuses | I3, I4 |
| I6 | Components-only install on test and production, with the installer credential | absent for every other write; refuses a component not in the development journal; the credential never reaches disk, logs, journal or errors; the read-only check still runs for every other use case; parity report after | I5 |
| I7 | Anchors and demo data exception | anchor rows keep their sys_id across loads; metadata referencing a non-anchor record is a finding; the pack's demo set loads, a git-tracked customer directory is refused | S-D |
| I7b | Domains: explicit domain on created records and loaded rows, the gate rule, domains in the plan | a created notification with no domain blocks on a domain-separated instance; a row loads into its `domain` column's domain; the plan lists each record's domain | S-H |
| I8 | Module sheets: template check and generated sections | a stale generated section fails the pack test | I1 |
| I9 | Docs and agent pack | commands reference regenerated; the deliver skill runs `install`, never its steps | I5–I8 |
| — | **Release** (minor) | | I1–I9 |

## 7. Phases: content (the ITSM pack)

Every module is done when: its Fluent source validates with no findings; it lands in its own
update sets; its data loads twice with nothing changed the second time; its ATF suite passes; its
demo storyline is walked and recorded; its module sheet is complete; a second install changes
nothing.

| Phase | Modules | Content |
|---|---|---|
| 1 | `foundation` | Switch properties; import sets for company, location, department, user, group (members, roles through groups), schedule entries, business and technical services, offerings, business applications, CIs; schedules (24x7, business hours, holidays); persona groups and demo offerings as anchors; a fictional company: about 3 regions, 60 users, 15 groups, 10 services, 20 offerings, 40 CIs |
| 2 | `incident-core`, `incident-tasks`, `incident-sla` | Taxonomy, priority rules, hold reasons, routing chain, reminders and auto-close; tasks and parent/child; SLAs and OLAs; notifications; workspace configuration; Employee Center "Report an issue"; about 10 seed articles |
| 3 | `request` | Request, item and task lifecycle; fulfilment patterns as reusable subflows (no approval; manager approval; manager plus cost approval above a threshold; parallel teams through an order guide); shared variable sets (requested for, justification, cost centre, delivery location); request SLAs; notifications; "My requests" |
| 3 | `catalog-it`, `catalog-people`, `catalog-workplace` | IT Services: laptop, monitor and peripherals, mobile phone, standard software, licence removal, application access, shared mailbox, distribution list, file share, VPN, something else. People: new hire (order guide), leaver, role change. Workplace: access badge, desk move. None depends on the platform's demo items |
| 4 | `problem` | Reactive and proactive problems, known errors, the incident link |
| 5 | `change` | Standard, normal and emergency models, CAB, conflicts, risk from offering criticality |
| 6 | `major-incident`, `on-call` | Trigger rules, communication plans, outage and status; rotas as data in On-Call's scope; complete with email, push and the On-Call mobile app; Twilio voice and SMS and the Teams bridge optional, behind aliases (D8) |
| 7 | `knowledge`, `virtual-agent`, `ai-tier-1` | Knowledge lifecycle, VA topics, recommended actions, Predictive Intelligence definitions |

## 8. Safety tests (added to the invariants suite)

- On test and production, `install --components-only` is the only write use case registered.
- The installer credential is accepted by no other use case and never written to disk, logs,
  the journal or errors.
- The components-only plan refuses any component or version not in a completed development
  journal for the same profile.
- `install` writes metadata only through `push` and data only through `load` (registry test over
  the ports it receives).
- A lost response during a component install is never followed by a second install request
  before the state is read.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Components can't be uninstalled; a wrong one on production stays | Parity only, admin approval by plan id, the plan states irreversibility |
| Customizations in ServiceNow-owned scopes are skipped at upgrade | Prefer the application's extension points; the plan flags each changed out-of-box record |
| Store application install needs an entitlement the instance lacks | `check` reports "not entitled"; nothing depending on it is installed |
| Plugin activations take long or stall | Budget per component, resume by re-run, progress id journaled |
| Fluent creates records in a child domain incorrectly | Spike S-H first; per-account variation as data until it passes |
| PDI demo data makes the baseline less clean | Modules never depend on platform demo items; the baseline is rebuilt on a fresh instance |

## 10. Execution: the first slice (2026-10-18, autonomous run)

**Target to show:** on pdi2, one command installs the `core` profile of the ITSM pack from
`ntt-accelerators`:

```
snagentic accelerator install itsm pdi2 --profile core              # writes the plan for the admin
snagentic accelerator install itsm pdi2 --profile core --confirm <plan-id>
```

It checks components, pushes the `foundation` module into its own update set batch, loads the
fictional demo company from the module's CSV files, and commits an install report. Running it
again changes nothing. Evidence: the plan and report in git, the update sets and records on pdi2.

**Order of work:**

| Step | What | Milestones |
|---|---|---|
| 1 | S-G: the minimal pack on the Fluent route, live, before any change | S-G |
| 2 | Pack format 2: modules in folders (`modules/<m>/module.yaml`), components (plugin or app), profiles, no pack scope, no waves; the minimal pack converted; demo data read from the pack | I1 |
| 3 | Packs from a path: `snagentic.yaml` `accelerators.paths` | I1 |
| 4 | S-D: anchors through a Fluent `ImportSet`, live | S-D, I7 |
| 5 | The `foundation` module in `ntt-accelerators`: properties, import set tables and transform maps, schedules, demo CSVs; installed step by step with the existing commands | content phase 1 |
| 6 | Install plan document and plan id; the orchestrator, journal and lock, on development | I4, I5 |
| 7 | `install` live on pdi2, twice; evidence recorded here | – |

**Left for later, by design:** the components-only install on test and production (I6) waits for
ADR-0038 to be accepted; the store application installer (I3) waits for spike S-F; the scope
gate rule (I2) waits for S-E; generated module sheet sections (I8).

**What "top quality" means for content**, checked for every module:
- out-of-box first: platform plugins and their configuration before anything new, and nothing
  that changes an out-of-box record where an extension point exists;
- CSDM-aligned data: offerings carry support group, schedule and criticality; roles only through
  groups;
- every switch is a documented property with a default and its variations;
- every module reinstalls with nothing changed, and its sheet says what it does with a data flow.

### Results of the first slice (2026-10-18)

| Step | Result |
|---|---|
| 1. S-G | Passed on pdi2: the minimal pack added, validated, planned and pushed on the Fluent route into its own batch, demo data loaded from the pack. Its records already existed from spec 005's M7, so creation was proven by step 5 |
| 2–3. Format 2, pack paths | Built (`211789a`). `ntt-accelerators/packs` is read from the workspace's `accelerators.paths`; store applications are checked against the store application inventory |
| 4. S-D | Passed: `tools/spikes/s-d-anchors/README.md`. Anchors are created with their fixed sys_id by the transform's map script (`setNewGuidValue`), matched on it when reloaded or renamed; other rows match on their business key. Found and fixed: a new table's collection row was refused on the next plan (`1d98d22`) |
| 5. foundation | `ntt-accelerators` module with 11 entities: 262 units pushed (2 min 9 s), 156 demo rows loaded in 58 s, a second load changes nothing. Roles reach users through groups; offerings carry support group, schedule and criticality |
| 6. install | Built (`4bc6e77`): plan document, plan id, journal, lock, resume |
| 7. install live | `accelerator install itsm pdi2 --profile incident --demo`: plan `d4bab70c992a5db6`, then confirmed: foundation skipped (already as built), incident-core 0.1.0 created (5 units into its own update set), data unchanged, mirror refreshed, plan and report committed in 2 min 41 s. The storyline's incidents INC0010024–26 were routed by offering, raised for a VIP and fell back to the Service Desk as the sheet says |

Found on the way, for the next steps:

- **Choices are checked only on the instance.** A demo row with an inactive time zone was rejected
  by the transform (correctly, with its reason) but only at load time. `validate-data` could check
  choice values against the mirror before any load.
- **`install` needs the keys step.** After `add`, the build's IDs must be committed (SN-MNT-010);
  install does it through `fluent-keys` for the files the module copied.
- **Activation of an inactive plugin** is wired and unit-tested but not exercised live: every
  component was already active on pdi2.
- **Left on pdi2:** the S-D probe table and transform map (update set "acc-sd probe"), the minimal
  pack's update sets, three demo incidents.

| Milestone | Status |
|---|---|
| I1 modules, components, profiles, pack paths | Done |
| I4 install plan and plan id | Done |
| I5 orchestrator, journal, lock (development) | Done |
| I7 anchors and the demo data exception | Done, except the finding for metadata that references a non-anchor record |
| I2, I3, I6, I8, I9 | Open (I6 waits for ADR-0038's acceptance; I3 for S-F; I2 for S-E) |

## 11. Second slice: incident-relations and incident-task (2026-10-18)

**Owner principle (2026-10-18): accelerators are agnostic to what exists on the instance.**
A module must give the same result on a fresh instance, on a heavily customized one, and on
one where it already ran. Concretely:
1. it **adds**, and never replaces configuration a client may have changed (a form layout, a
   related list, an out-of-box SLA);
2. it finds existing records by **business key** (the incident Default view; the SLA named "P1
   resolution"), never by an id seen on one instance;
3. it states what it expects, and the install plan shows what is missing and what it will do
   (create, skip or block);
4. it never overwrites a client's customization silently.

What was installed on pdi2 (`accelerator install itsm pdi2 --profile incident-advanced --demo`):
- **`incident-relations` 0.1.0** (5 units): the Related Changes relationship and the
  child-resolves-with-parent rule;
- **`incident-task` 0.1.0** (11 units): task field inheritance, no resolution with active tasks
  unless confirmed, the "all tasks complete" note, and the classic-form button and
  confirmation.

Each module went into its own update set. An update to a module re-pushed only the 2 changed
rules.

**Tested on pdi2 through the API:**
- a task inherits the incident's fields, and one given its own values keeps them;
- resolving an incident with an active task is refused.

The classic-form confirmation (an onSubmit prompt, then the GlideAjax session flag) needs a
signed-in browser session and is not yet exercised.

**Found, and the work it adds:**

| # | Finding | Work |
|---|---|---|
| F1 | A resumed install planned a finished module again, taking in later modules' files | **Fixed** (`72bc463`): a resumed run skips the modules its journal records as finished |
| F2 | The platform cut a business rule name to the field's 40 characters, so the push reported "not applied as built" and the next plan refused it | **I11, length guard:** `validate` checks built string values against the dictionary's `max_length` from the mirror's catalog, before any push |
| F3 | Placing related lists on the incident form needs changes to out-of-box layout records, and plan refuses records this branch never adopted | **I10, ensure rules:** see below |
| F4 | `incident-core`'s fallback group property holds the demo anchor's sys_id. With a client's own data and no demo, the group does not exist | **I12, settings as data:** property values that depend on data are loaded with the data (an entity targeting `sys_properties`, matched on `name`), so each environment sets its own. `incident-core` ships an empty default |
| F5 | A record removed with the Table API was captured in the user's Default update set, and collided with the module's set | Spike tools only. Product removals go through snagentic |

**I10 ensure rules (proposal; needs an ADR because it is a new content kind):**
- **What a module declares:** `modules/<m>/ensure.yaml`, a list of declarative facts about
  configuration it does not own. For example:
  - "table `incident`, view `Default`, has the related list `incident_task.incident`";
  - "the SLA definition named `Priority 1 resolution (1 hour)` is inactive".
- **Planning:** each fact is resolved by business key against the mirror. The install plan
  lists, for each fact:
  - already true: nothing to do;
  - missing: add it, appended after the client's own entries;
  - target absent: skip, with the reason;
  - conflicting: block for review.
- **Applying:** on a development instance, the install applies each change into the module's
  update set, so it promotes with the rest of the module. Facts are additive. A deactivation
  never deletes.
- **Supported kinds:** each kind is a small, tested operation, and nothing is free-form. The
  first ones are:
  - related list entries;
  - form section fields;
  - active flags.
