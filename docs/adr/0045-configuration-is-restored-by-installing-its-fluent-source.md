# 0045. Configuration is restored by installing its Fluent source on a development instance

- Status: Proposed (2026-10-27). Rewritten the same day at the product owner's request: reuse
  the Fluent route that installs accelerator modules, and add no second write route
- Date: 2026-10-27
- Requirements: G1, ASR-02, ASR-03, ASR-15, ASR-16
- Amends, when accepted: 0010 (adds configuration restore to the scope)
- Relates to: 0012 (unchanged), 0031 (Fluent is the only authoring format and write route),
  0033 (plans compare the build with the instance; ledgers per instance), 0038 (install by plan,
  component installer, take-over of out-of-box records)
- Plan: `specs/013-configuration-restore/plan.md`

## Context

A customer wants snagentic as the configuration half of a cyber-resilience strategy. Suppose an
attacker changes the instance's code or configuration. A known-good configuration from before
the attack must then be rebuilt on another instance. Another tool restores business data,
attachments and secrets. An external scheduler runs snagentic.

The product owner asked to reuse what installing accelerator modules already proves, rather than
build a new capability (2026-10-27). That route is:

- **Fluent source.** Fluent source in `source/<scope>/` is built by the SDK and delivered by
  push into update sets, with the plan id, the gate and the capture check (ADR-0031).
- **On a fresh instance:**
  - a unit the target doesn't hold is planned as `create`;
  - an out-of-box record the source declares, still as shipped, is recorded as the branch's by
    `take-over`, so the next plan loads over it (ADR-0038, item 8). The ledger is kept per
    instance (ADR-0033), so a new target needs no special case.
- **The install runner.** `accelerator install` turns a fresh development instance into a baseline from one
  approved plan: components, pull, take-over, push per module into its own update set, resume by
  re-running (ADR-0038, section 2). The ITSM install pushed 262 units in 2 minutes 9 seconds.

What is missing is the source itself. `adopt` reads records from a live development instance
through the SDK. The mirror can't replace it: its raw values lack the reference keys `transform`
needs (S16 F1). So the recovery point can't be rebuilt from a mirror at restore time. It has to
exist as Fluent source before the attack.

## Decision

1. **The recovery point is Fluent source, not the mirror.** A customer's configuration is held as
   Fluent source in the workspace, reviewed and versioned in git. A known-good commit of that
   source is what is restored.
2. **Bootstrapped once, from a development clone of production.** Bulk adopt brings every
   customer-changed record of a scope into source. On the clone, a record is customer-changed
   when its update name has a customer update (`sys_update_xml`), the test `take-over` already
   uses. Adopt's refusals are listed by reason in a coverage report:
   - secrets;
   - store application scopes;
   - records adopt refuses by design;
   - unexplained differences.

   They are the restore's exclusions. Production is never written, and adopt never reads it.
   ADR-0012 is unchanged.
3. **Kept current by the normal development flow.** Changes are made in source and delivered through
   development and promotion. `adopt --refresh` on a fresh clone catches changes made outside it.
   The external scheduler pulls production every hour, read-only, as today. Its mirror commits
   are the evidence of what production held and when. A production change that never reached
   source is either a gap to adopt or the attack, and it is not part of the recovery point.
4. **Restore is an install of the workspace's own source.** The install runner gains a second
   content source: the workspace's projects at a chosen commit, one module per scope, instead of
   a pack. Everything else is the runner as it is:
   - **plan, read-only:** components to install, out-of-box records to take over, units per scope,
     exclusions, and a plan id;
   - **`--confirm <plan id>`:**
     1. install components;
     2. pull and integrate;
     3. take over out-of-box records;
     4. per scope: validate, plan-push and push into `snagentic restore <commit> [<scope>]`;
     5. pull and report.
5. **Components at parity with the snapshot.** The plugins and store applications to install are the
   ones the source instance's mirrored inventory lists, at the commit's time, at those versions.
   This needs the store application installer that spec 011 already plans (I3).
6. **The target is a development instance.** A subprod instance used for recovery is registered as
   kind `development`. snagentic never commits the update sets; promotion is the customer's process.
7. **No new write route, no new gate.** Every write is the runner's existing one: component
   installer, take-over, push. The gate is the push gate, unchanged.
8. **CLI only.** Like `accelerator install`, restore is not an MCP tool or a hook. It is
   destructive, `requiresDevelopmentInstance`, and absent for test and production.

## Consequences

- **The work is small.** The pieces are:
  - a selector for customer-changed records in `adopt`;
  - the coverage report;
  - a second content source for the install runner;
  - components taken from a mirrored inventory;
  - the store application installer, already planned.
- **The recovery point is reviewed code.** What production held at the time of an attack is not restored
  unless it reached source. The hourly mirror shows what changed; source decides what is good.
- **Coverage is limited to what adopt accepts.** The bootstrap spike measures it on a real instance. The
  exclusions need a manual runbook, or a later ADR for a fallback.
- **Source must stay current.** Configuration changed only on production, outside the development flow, is
  not in the recovery point until it is adopted. The guide recommends a refresh cadence.
- **Data restored by another tool must keep its sys_ids.** References from adopted metadata (groups,
  roles) hold only then. Spike RF-3 checks that adopted records keep theirs on the target.
- **Restoring into production stays impossible**, by construction.

## Alternatives considered

- **Render update set XML from the mirror** (this ADR's first draft). It covers more records and
  needs no bootstrap, but it adds a second write route beside Fluent (against ADR-0031) and a
  renderer of its own. It is the fallback if adopt's coverage proves too low.
- **Generate `Record()` units from the mirror.** It is also a second source of units. It goes against ADR-0038's
  guidance on typed APIs, and loses named references.
- **Adopt from production, read-only, through `transform`.** It needs no clone, but it amends ADR-0012
  and ADR-0031. The product owner chose a development clone (2026-10-27).
- **Platform clone or backup services.** These are the customer's other tool. They restore an
  instance whole, the attack included if the copy postdates it.
