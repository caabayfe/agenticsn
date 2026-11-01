# 0038. Accelerators install by plan; platform components install automatically on every instance

- Status: Accepted (product owner, 2026-10-19; decisions of 2026-10-18). Spike S-E passed; the
  store application installer (I3) still waits for spike S-F of spec 011. Section 6 amended
  (upgrades complete the pack's earlier update sets), accepted 2026-10-22. Item 8 amended by 0042
  (layouts a module does not own are ensure rules, found by table and view). Components
  amended 2026-10-24 by the product owner: a module whose component cannot be installed is
  skipped with its dependents, and the rest installs (section "Components the install cannot
  install")
- Date: 2026-10-18
- Requirements: G1, ASR-01, ASR-02, ASR-08, ASR-10, ASR-15, ASR-16
- Amends: 0012 (one narrow write on test and production), 0026 (the rejected single install,
  the pack scope, the manifest), ASR-15
- Relates to: 0011 (enforcement layers), 0016 (instance load), 0018 (update sets read live),
  0031 (Fluent authoring), 0033 (plans compare the build with the instance)
- Plan: `specs/011-accelerator-install/plan.md`

## Context

ADR-0026 made an accelerator a content pack, installed in several commands: `check`, `plugins
activate`, `pull`, `add`, `validate`, `plan_push`, `push`, `load`. Building the ITSM pack showed
four forces it did not weigh:

1. **A baseline must be rebuilt from zero, often.** A top-quality reference instance is only
   robust if it can be reinstalled unattended on a fresh instance, through slow plugin
   activations (minutes to tens of minutes) and the timeouts that come with them. A dozen
   commands per module, run by hand or by an agent, is neither repeatable nor fast.
2. **A platform admin must accept the install before it runs.** They need to read what will
   change, why, and what cannot be undone, in one document, and approve exactly that.
3. **Plugins and store applications never travel in update sets.** Customizations reach UAT and
   production through the platform's own update set promotion. The components they need must
   already be there, at the same versions as on development. Installing them by hand on every
   instance is slow and error-prone. The product owner decided that snagentic installs them
   automatically, on every instance kind (2026-10-18).
4. **ServiceNow scopes are owned.** Most customizations are on global tables, but some target
   tables and records owned by a ServiceNow application (On-Call Scheduling, for example). A
   customization must live in the scope that owns its target. A pack scope of our own
   (`x_nttdata_acc`) adds little that git and update set names don't already give, and costs a
   second update set per module, cross-scope privileges, and the open vendor-prefix question.

## Decision

### 1. Modules, components and scopes

- A pack is made of **modules** (the manifest's capabilities). A module declares the modules it
  depends on, its **platform components**, its Fluent projects and its data entities.
- A **platform component** is a plugin or a store application: `{ kind: plugin | app, id or
  scope, minVersion, entitlement }`.
- **A customization lives in the scope that owns its target.** A module holds one Fluent
  configuration project per scope it touches (`source/global/`, `source/<scope>/`). There is no
  pack scope. A module creates a scope of its own only when it builds a new application, with
  tables and a lifecycle of its own.
- A gate rule blocks a record placed in a scope that doesn't own its table, or created from a
  scope the table's application access doesn't allow, read from the mirror's table model.
- A module is delivered as one **parent update set** with one child per scope, so it is promoted
  as a unit.
- **Profiles** name sets of modules (`demo-full`, `incident-only`). Dependencies are added
  automatically.

### 2. `accelerator install` runs the existing steps from one approved plan

`accelerator install <pack> <instance> (--profile <p> | --modules <m,...>)` (CLI only):

1. **Plan (read-only).** Resolve modules and dependencies in order; pull; check instance kind,
   component states, entitlements, platform release, SDK version, sys_id collisions. Write the
   **install plan** (section 3) and stop.
2. **`--confirm <plan-id>`** runs exactly that plan:
   1. components, one at a time, in dependency order (section 4);
   2. pull and integrate, so the mirror and the gate see the new tables;
   3. per module: `add`, `validate`, `plan_push`, `push` into the module's parent update set,
      with the capture check, then a git commit for the module;
   4. data: validate every template, then load in dependency order (ADR-0026, section 3);
   5. pull and integrate; commit the install report.
3. Every step calls the existing application service. There is one gate, one metadata write path
   (`push`) and one data path (`load`); `install` adds orchestration, not writes.
4. **Resume is a re-run.** Every step is idempotent: an active component is skipped, a module
   whose plan is empty is skipped, matched rows come back unchanged. A journal
   (`.snagentic/installs/<id>.json`) keeps progress ids, timings and the approver. After a
   timeout, nothing is resent blindly: a component's state is read from the instance, and a
   module is planned again against the instance (ADR-0033).
5. **One install per instance at a time** (a lock), because pushes switch the user's preferences.

On development instances the whole plan runs. On test and production instances only step 2.1
runs (section 5).

### 3. The install plan is written for the platform admin

A Markdown document, committed, and printed in the terminal:

- summary: instance and kind, profile and modules, expected duration, what the install will not do;
- components: each plugin or application, version, the module that needs it, the dependencies the
  instance reports it brings, irreversibility, demo data off;
- customizations per module and scope: record counts by type, every out-of-box record changed
  (flagged for upgrade impact), update set names;
- data: entities, row counts, demo or customer data, how re-runs match rows;
- risks and recovery: timeouts, resume, what cannot be undone.

Its **plan id** is a hash of its content and of the instance facts it was built from. `--confirm`
with another id, or after those facts changed, refuses. The journal records who confirmed it.

### 4. Components install through the platform's installer

Plugins and store applications both go through the platform's CI/CD installation APIs: start,
follow the progress record (poll, budget per component, honour cancellation), confirm the result
on the instance. A lost response leaves the state unknown: the progress id is journaled and the
next run reads it, never re-requests. Demo data is never loaded. Which API installs store
applications, and with which roles, is spike S-F.

### 5. Test and production: components only, at parity, with a separate credential

This is the one write snagentic makes to test and production instances. It is bounded so the
rest of ADR-0012 holds unchanged:

- **Components only.** No metadata, no records, no data, no update set actions. Customizations
  arrive through the platform's update set promotion (retrieve, preview, commit), done by the
  customer's process; data is loaded there with the delivered import sets by the delivery team
  (ADR-0026, section 3).
- **Parity only.** The plan can only install the components, at the versions, that a completed
  development install recorded in its journal for the same profile. It cannot choose others.
- **A separate installer credential.** Installing needs `admin`. The credential is supplied at
  run time (interactive prompt, or environment variables in a pipeline) and never stored in the
  keychain or the instance profile. Only the component installer can use it. Every other use
  case keeps the read-only profile, checked as today (ADR-0012, layer 4).
- **Not reachable by the agent.** `install` is not an MCP tool and not a hook. On test and
  production it is registered only as `install --components-only` (layer 3: no other write use
  case exists for those kinds). An agent without the admin credential cannot run it.
- **Verified after.** A read-only check reports parity: the target now holds the components and
  versions of development.

ASR-15 is amended: *troubleshooting* test and production remains read-only; the only write is the
component installer, under the conditions above.

### 6. Update sets on development

`push` leaves each module's update sets in progress. Completing them, and promoting them, is the
platform's standard mechanism and the customer's process (ADR-0018).

**Upgrades complete the earlier versions' update sets.** Amendment accepted by the product owner
(2026-10-22), made at their request ("an upgrade should be a standard action"). Pack 0.3.1 could not be
installed on pdi2: `ACCRelatedChanges` sat in `snagentic: itsm 0.1.0 upgrade`, still in progress,
and the install stopped rather than take the record over. Taking it over is not enough: with the
record in two sets in progress, whichever is committed last on UAT wins, so promoting the 0.1.0
set after the 0.3.1 one would silently bring the old version back. Cancelling the old set is
worse: it holds records the new version does not change again, which would never reach UAT.

- **Upgrades never stop for the pack's own earlier sets.** A set is the pack's own when an
  earlier install of the pack recorded pushing into it (the install reports committed in the
  workspace, whose delivered steps are written and read by one function) or when its name follows the pack's naming (`snagentic: <module label>
  <version>`, `snagentic: <pack> <version> upgrade`, with an optional ` [scope]` child) for a
  version older than the one installed. Renamed modules are still found through the reports.
- **The plan lists them.** It reads the update sets live (ADR-0018) and lists every earlier set
  of the pack still in progress, whichever module made it: completing them all keeps one
  promotion order. The list is part of the plan id: a set completed or added since makes a new
  plan.
- **The run completes them first.** On the development instance, before the first push, the
  install sets each listed set (parent and children) to complete. This is a change of state, not
  a promotion: it is undone by setting the set back to in progress, and nothing leaves the
  instance. The report gives the promotion order: the earlier sets, oldest first, then the new
  ones.
- **Still stops:** a record held in an update set that is not the pack's own (someone else's
  work in progress, ADR-0018), and a set of a **newer** version of the pack (a downgrade). The
  push's collision check is unchanged: it reads only sets in progress, so once the earlier sets
  are complete their records no longer collide.
- Test and production are unchanged: never written, and promotion stays the customer's process.

The plan's "will not move an update set" still holds: the install never moves, retrieves,
commits or cancels a set. On development it completes the pack's own earlier sets that the admin
approved in the plan.

### 7. Packs are read from a path; pack-owned records are anchors

- **Packs live outside snagentic**, in a private repository (`ntt-accelerators`), and are read
  from the paths a workspace names (`snagentic.yaml` `accelerators.paths`). This replaces the
  `nttdata/` folder of ADR-0026's 2026-10-14 amendment. snagentic keeps only its minimal test
  pack. A local path is as trusted as the workspace: its content still goes through `validate`,
  the gate and `push`. Downloading packs from a registry stays deferred (ADR-0026).
- `check` warns when the pack's `requires.snagentic` or SDK version differs from the binary's.
- **Anchor records.** Data rows the pack owns (persona groups, demo offerings) carry a fixed
  sys_id in the template; the transform sets it on insert and matches on it on re-run, so a
  customer may rename them. Metadata may reference only anchors; a reference from pack metadata
  to any other data record is a finding. Customer-specific references live in data.

### 8. Modules are agnostic to the instance, and follow ServiceNow SDK practice

Added 2026-10-18 at the product owner's request: "the accelerators are agnostic to what
exists in the instance", and "everything needs to follow the SDK best practice where possible,
so we can have the right support from ServiceNow".

**What a module may do:**
- **Additive by default.** A module creates its own records. It never changes a client's
  customization silently.
- **SDK APIs as the SDK models them.** Scripts are in files (`Now.include`). `Record()` is
  used only where the SDK has no API. Forms and lists are declared whole (`Form()`, `List()`).
  snagentic never patches the SDK's output or writes configuration around it. SDK gaps are
  reported to ServiceNow.
- **Taking over an out-of-box layout.** Some modules need fields or lists on a form they do
  not own (for example impact and urgency on the incident task form). Such a module:
  - declares the whole layout in its source;
  - lists the out-of-box record in `adopt.yaml`.

  The install plan then checks each listed record on the instance:
  - **untouched since the platform shipped it** (no customer update recorded under its update
    name): the module takes it over, and the plan lists it under "Out-of-box records changed";
  - **customized by the client:** the plan **blocks for review**, naming the record, and
    nothing is merged or overwritten.

  On a fresh baseline instance every layout is untouched, so the install runs without stops.

  Amended 2026-10-20 at the product owner's request ("if they don't exist, create them"): some
  out-of-box records ship only with demo data (the incident SLAs), so a valid instance may lack
  them. An `adopt.yaml` entry may say `when_absent: create`: where the instance lacks the
  record, the install creates it from the module's source, which restates it whole, instead of
  stopping. Every instance ends with the same records. Without it, a lacking record stops the
  module for review, as before.

  Amended 2026-10-25 at the product owner's request: **a shipped record the source stops
  restating is released, never deleted.** itsm 0.11.2 stopped restating the shipped property
  `glide.knowman.task_kb` (setup now writes it), and the plan refused it as a removed
  definition, asking for a `Now.del` that would delete the platform's own record. Now, when a
  ledger entry's definition leaves the source and the record is on the instance with a plugin's
  package (`sys_package` neither `global` nor the project's scope), the plan releases it: push
  drops the ledger entry and changes nothing on the instance. A removed definition of a record
  the project made still needs a `Now.del` or a restore (ADR-0031 item 7).

  Proposed amendment, 2026-10-30 (pdi2): a project in a plugin's scope (major-incident in
  `sn_major_inc_mgmt`) shares that scope's package with the plugin's records, so the package
  alone took MIM's own group property for the project's and the install stopped. In the
  project's own scope, a record is also shipped when one of its versions came with a store app,
  a plugin or an upgrade (`sys_update_version.source_table` `sys_store_app`, `sys_plugins` or
  `sys_upgrade_history`). When the versions cannot be read, the plan keeps refusing.
- **Shipped records only.** A module may reference an out-of-box record shipped by a plugin
  (the same sys_id on every instance); the plan checks it exists.
- **Platform fields it reads.** Proposed amendment, 2026-10-20 (pack gap G13; the product
  owner delegated the decisions F1-F4 and is to confirm them). pdi2 lacks
  `incident.problem_id`, `rfc` and `caused_by`, which shipped forms use, and modules reading
  them failed quietly. A module lists the platform fields it reads in `module.yaml`:
  `fields: [{ field: table.field, from: plugin, when_missing: stop | warn, note }]`. The fields
  its data columns fill are added without a declaration (the pack's own `u_` and `x_` names are
  left out). The install plan checks them against the mirror (a field of the table or one of
  its parents), never the instance:
  - a missing field blocks its module (`stop`, the default), or is a warning saying what the
    module loses (`warn`);
  - each names the plugin that ships it, to repair or activate before a new pull;
  - the plan lists the fields that are not on the instance and counts the rest; a pull that
    brings a field back makes a new plan id.

  Older snagentic versions ignore the key, so a pack can declare fields before it requires the
  version that checks them.
- **Components the install cannot install.** Amendment by the product owner, 2026-10-24 ("it
  needs to continue and skip what needs this module"). A store application the instance does
  not offer (the ITSM Advanced app on a PDI) made every module wait on it. Now:
  - a selected module whose component the install cannot install (missing, too old, or an
    inactive store application) is **skipped**, and so is every selected module depending on
    it; the plan lists each with its reason, and nothing of theirs is pushed or loaded;
  - the rest installs; a selection left empty blocks the plan;
  - a skipped module's own inactive plugin is not activated;
  - the gate's accelerator check (SN-MNT-012) blocks only the planned records of a module that
    is not ready (records are told apart by the fixed `$id`s of the module's source), so a
    module that waits on a component never stops another module's push.

  Installing the component and running the install again installs the skipped modules.
- **Business keys for anything else.** Records the client owns, such as a group or a schedule,
  are found by business key. Settings hold the key, not a sys_id.

## Consequences

- A baseline instance is rebuilt by one approved command and re-runs after any failure.
- The admin reviews one document per install and approves it by id.
- UAT and production get their components automatically and provably at parity with development,
  while every other read-only guarantee stays as it was.
- snagentic holds an admin credential on test and production for the first time, briefly and
  for one use case. Safety tests: no other use case accepts it; it is never written to disk,
  logs or the journal; the components-only installer refuses anything not in the development
  journal.
- The vendor-prefix question (ADR-0026, S-A) no longer blocks packs: they create no scope of
  their own.
- Customizing ServiceNow-owned scopes records customer customizations that upgrades skip; pack
  review prefers each application's own extension points.
- New work: packs from a path, anchors and their finding, modules and profiles in the manifest, components (plugin or app), the scope gate rule,
  the install orchestrator, plan document and journal, the store application installer, the
  components-only installer and its credential handling. Spikes S-E (Fluent loads into a
  ServiceNow-owned scope, captured in its update set) and S-F (store application install API).

## Alternatives considered

- **Keep separate commands (ADR-0026).** Rejected for the reasons in the context: not
  repeatable, not resumable, and no single document for the admin to approve.
- **A single install that writes on its own path.** Rejected, as in ADR-0026: it would duplicate
  the gate, journal and capture checks of `push`.
- **A pack scope for everything the accelerator owns.** Rejected: most targets are global or
  owned by another scope, and git and update set names already give provenance.
- **Global for every customization.** Rejected by the product owner: targets owned by an
  application's scope must be customized in that scope.
- **The customer's pipeline installs components on test and production from snagentic's plan.**
  Keeps ADR-0012 whole, but adds a hand-off on every instance; the product owner chose automatic
  installation.
- **snagentic promotes update sets on test and production.** Rejected by the product owner:
  update sets go through the standard mechanism.
