# 0045. Configuration is restored by installing its Fluent source on a development instance

- Status: Proposed (2026-10-27). Revised twice the same day at the product owner's request:
  - reuse the Fluent route that installs accelerator modules, with no second write route;
  - adopt from production with a read-only user, every hour to start with, so the recovery
    point is valid for business continuity without depending on a clone.
- Date: 2026-10-27
- Requirements: G1, G2, ASR-02, ASR-03, ASR-15, ASR-16
- Amends, when accepted:
  - 0010: adds configuration restore to the scope;
  - 0012: `adopt` runs against test and production, as a read;
  - 0031 item 3: `adopt` reads any instance kind, not only development.
- Relates to: 0016 (instance load), 0032 (the SDK's routes), 0033 (plans compare the build
  with the instance; ledgers per instance), 0038 (install by plan, component installer,
  take-over of out-of-box records)
- Plan: `specs/013-configuration-restore/plan.md`

## Context

A customer wants snagentic as the configuration half of a business continuity plan against
cyber attacks. The scope is the instance's **code, properties and configuration**. Business
data, users and groups, attachments and secrets are restored by another tool, which keeps their
sys_ids. The recovery runs in five steps:

1. **Sync:** an external scheduler syncs all code and properties of production, every hour.
2. **Rebuild:** on a fresh subprod instance, install the modules (plugins and store
   applications), then all the code and configuration, as update sets.
3. **Data:** the other tool loads the data.
4. **Test:** the customer runs end-to-end tests.
5. **Promote:** if they pass, the customer promotes the update sets to production with
   ServiceNow's own tooling.

snagentic covers steps 1 and 2. Steps 3 to 5 are the customer's.

The product owner asked to reuse what installing accelerator modules already proves, rather
than build a new capability. That route is:

- **Fluent source.** Fluent source in `source/<scope>/` is built by the SDK and delivered by
  push into update sets, with the plan id, the gate and the capture check (ADR-0031).
- **On a fresh instance:**
  - a unit the target doesn't hold is planned as `create`;
  - an out-of-box record the source declares, still as shipped, is recorded as the branch's by
    `take-over`, so the next plan loads over it (ADR-0038, item 8). The ledger is kept per
    instance (ADR-0033), so a new target needs no special case.
- **The install runner.** `accelerator install` turns a fresh development instance into a
  baseline from one approved plan: components, pull, take-over, push per module into its own
  update set, resume by re-running (ADR-0038, section 2). The ITSM install pushed 262 units in
  2 minutes 9 seconds.

What is missing is the source itself. The mirror can't be pushed: its raw values lack the
reference keys `transform` needs (S16 F1). The source has to exist as Fluent before the
attack, and it has to come from production itself. A copy taken from a clone or from the
development flow is not a valid recovery point for business continuity: it misses what
reached production another way.

`adopt` already reads in the way production requires. Its SDK calls are limited to Table API
`GET`s and two exports, `sn_glider/metadata/unload` and
`sn_glider/fluent_support/table_relationship_exporter` (ADR-0032, item 3). It writes only to
the workspace. It is registered for development instances only because it was designed for
editing, not because it writes to the instance.

## Decision

1. **The recovery point is Fluent source adopted from production.** The customer's
   configuration is held as Fluent source in a dedicated recovery workspace, versioned in git.
   Each sync is a commit, and a restore picks the commit from before the attack. The hourly
   mirror commits beside it show what changed and when, which helps choose that commit.
2. **`adopt` reads production with the read-only credential.** It joins the use cases
   registered for test and production as a read. All of ADR-0012's layers stay:
   - the credential holds `snc_read_only` and no write role, checked before each call;
   - the SDK connector allows only the routes above;
   - every request goes through the instance's scheduler and budgets.

   Spike RF-0 must show that the two exports work under `snc_read_only`, and that they leave
   no record on the instance. If they don't, this decision falls back to a development clone
   (see the alternatives).
3. **Bootstrap once, then follow production.**
   - **Bootstrap:** `adopt --customized --scope <s>` brings every customer-changed record of a
     scope into source. A record is customer-changed when its update name has a customer update
     in `sys_update_xml`, the test `take-over` already uses. Out-of-box records the customer
     deleted become `Now.del`.
   - **Each sync, in this order:**
     1. pull production (the mirror, unchanged);
     2. adopt the records the pull reports as changed, added or newly customized: it refreshes
        adopted ones and adopts new ones;
     3. commit.

     A sync with no changes adds no adopt request.
4. **Cadence.** The cadence starts at one hour and can be widened when the measured load on
   production calls for it (ADR-0016). snagentic doesn't schedule. The external tool runs
   `pull` and `adopt`, and the guide gives the cadence and the budgets.
5. **Coverage is reported, not hidden.** Each sync writes a coverage report: records adopted,
   and records refused, by reason:
   - secrets;
   - store application scopes;
   - records adopt refuses by design;
   - unexplained differences.

   Refused records are the restore's exclusions, and they need the customer's runbook.
6. **Restore is an install of the recovery workspace's source.** The install runner gains a
   second content source: the workspace's projects at a chosen commit, one module per scope,
   instead of a pack. Everything else is the runner as it is:
   - **plan, read-only:** components to install, out-of-box records to take over, units per
     scope, exclusions, and a plan id;
   - **`--confirm <plan id>`:**
     1. install components;
     2. pull and integrate;
     3. take over out-of-box records;
     4. per scope: validate, plan-push and push into `snagentic restore <commit> [<scope>]`;
     5. pull and report.
7. **Components at parity with production.** The plugins and store applications to install
   are the ones production's mirrored inventory lists at the commit's time, at those versions.
   This needs the store application installer that spec 011 already plans (I3).
8. **The target is a development instance.** A subprod instance used for recovery is
   registered as kind `development`. snagentic never commits the update sets it pushes.
   Testing and promotion to production are the customer's.
9. **No new write route, no new gate.** Every write is the runner's existing one: component
   installer, take-over, push. The gate is the push gate, unchanged.
10. **CLI only.** Like `accelerator install`, `restore` is not an MCP tool or a hook. It is
    destructive, `requiresDevelopmentInstance`, and absent for test and production.

## Consequences

- **The recovery point is what production held.** It is not reviewed code. A commit after the
  attack contains the attack, so choosing the commit is the restore decision, made with the
  mirror's history.
- **Production carries the load of each sync.** That means the pull, plus one transform per
  changed record. RF-4 measures both, and the cadence follows.
- **ADR-0012's surface grows by one read use case.** Its guarantee does not change: the
  platform, the role check and the route list each still prevent a write.
- **Coverage is limited to what adopt accepts.** RF-2 measures it on a real instance. The
  biggest unknown is customizations to ServiceNow's own scoped applications.
- **Data restored by another tool must keep its sys_ids.** References from the configuration
  to groups, roles and users hold only then. That tool should load with business rules and
  engines off, because the code is installed first. RF-3 checks that restored records keep
  their sys_ids.
- **Promotion is outside snagentic.** Applying the update sets on a compromised production
  overwrites the records they contain. It does not remove records the attacker added. This
  risk is accepted for now, and the customer's process owns it.
- **Restoring into production with snagentic stays impossible**, by construction.

## Alternatives considered

- **Adopt from a development clone of production** (this ADR's second draft). It leaves
  ADR-0012 unchanged, but the recovery point is only as fresh as the last clone, and a clone
  can miss production changes. It is the fallback if RF-0 fails.
- **Render update set XML from the mirror** (this ADR's first draft). It covers more records
  and needs no adopt, but it adds a second write route beside Fluent (against ADR-0031) and a
  renderer of its own. It is the fallback if RF-2's coverage is too low.
- **Generate `Record()` units from the mirror.** It is also a second source of units. It goes
  against ADR-0038's guidance on typed APIs, and loses named references.
- **Platform clone or backup services.** These are the customer's other tool. They restore an
  instance whole, the attack included if the copy postdates it.
