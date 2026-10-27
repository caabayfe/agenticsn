# 0045. Configuration is restored from a mirror snapshot into development update sets

- Status: Proposed (2026-10-27). The delivery route (decision 6) is chosen by the spikes of spec 013
- Date: 2026-10-27
- Requirements: G1, ASR-02, ASR-08, ASR-15, ASR-16
- Amends, when accepted: 0010 (adds configuration restore to the scope), 0031 (a second source
  for what reaches an update set: a mirror snapshot, never edited)
- Relates to: 0012 (unchanged: test and production are never written), 0016 (instance load),
  0018 (update set XML rendered from reads), 0034 (what the mirror leaves out), 0038 (the
  component installer)
- Plan: `specs/013-configuration-restore/plan.md`

## Context

A customer wants to use snagentic as the configuration half of a cyber-resilience strategy. An
external scheduler runs `pull` every hour, and the mirror branch keeps every version. If an
attacker changes the instance's code or configuration, a known-good snapshot from before the attack
must be rebuilt on another instance. Business data, attachments and secrets are restored by
another tool.

What snagentic has today:

- **The snapshot.** Every pull commits the instance's metadata (ADR-0017) and its installed
  plugins and store applications, with versions (`operational/plugins.yaml`, `store_apps.yaml`), to
  `servicenow-remote/<name>`. An incremental pull with no changes costs 22 requests (ASR-16).
- **The components.** The installer from ADR-0038, section 4, activates plugins through the CI/CD API,
  journaled and never retried. Spike S-F found the store application API; the installer (I3) is
  not built.
- **No restore route.** Push delivers only Fluent source, and `adopt` reads it from a live development
  instance (ADR-0031, item 3). In a recovery, the source is production (read-only) or compromised.
  The mirror's raw values can't be transformed into Fluent: they lack the reference keys
  `transform` needs (S16 F1).
- **Rendering update set XML.** `update-sets export` already renders ServiceNow's unload format
  from reads (ADR-0018, item 2). Update XML holds references as raw sys_ids, as the mirror does.

## Decision

1. **Scope: configuration and components.** snagentic restores the metadata the mirror holds and
   reinstalls the plugins and store applications the snapshot lists. Business data, attachments,
   users, groups, CMDB, audit history, credentials, certificates and encryption keys are out of scope.
   The restore plan names what it leaves to other tools.
2. **The source is a mirror commit, never an instance.** `restore` takes an instance name and a
   commit on its mirror branch. It refuses a commit left by an interrupted pull, and names the
   classes the snapshot could not read (ADR-0034). The source instance is never contacted.
3. **The target is a development instance.** A subprod instance used for recovery is registered as kind
   `development`. ADR-0012, ASR-15 and ADR-0038, section 5, are unchanged: nothing is restored into test
   or production. Promoting the restored update sets onwards is the customer's process.
4. **The release must match.** The target's family and build must be the snapshot's. Otherwise
   `restore` refuses: plugin versions and out-of-box records depend on the release.
5. **Steps, from one approved plan** (as in ADR-0038, section 2):
   1. **Components.** Install the snapshot's active plugins, then its store applications, at the
      snapshot's versions, in dependency order, with demo data off. Apply the same budget, journal and
      "read, never re-request" rule as ADR-0038, section 4.
   2. **Pull** the target.
   3. **Plan.** Compare the snapshot with the target's mirror, record by record: create, update or
      delete, grouped by scope. This is a pure domain function. The plan id hashes the snapshot
      commit, the target's mirror commit and the plan. Records of store application scopes are
      left to step 1. Fields and classes the mirror leaves out (redacted, denied) are listed as
      a checklist to restore from the vault.
   4. **Write** the plan into update sets named `snagentic restore <commit> [<scope>]`, in batches
      that stay within ADR-0016. snagentic never commits them; an admin reviews and commits them.
   5. **Verify.** After the admin commits, pull the target and compare it with the snapshot again.
      Only the listed exclusions may differ.
6. **Delivery route: chosen by spike.** The candidates are:
   - **R1, rendered remote update sets.** Render each record of the plan (with its child rows) as
     update XML, from the mirror's raw values. Load the XML into a retrieved update set on the
     target; the admin previews and commits it with the platform's own collision handling.
     sys_ids are kept. This is a new write (rows of `sys_remote_update_set` and
     `sys_update_xml`), on development only.
   - **R2, `Record()` units through push.** Generate one `Record()` unit per record, with `$id`
     and raw values, and deliver them through the existing plan, gate and push. This is against
     ADR-0038's guidance to use typed APIs, and it must be proven at instance scale.

   Spec 013 measures both against the same sample. The accepted version of this ADR names one.
7. **CLI only, not an agent tool.** `restore` is not an MCP tool and not a hook. It is destructive and
   `requiresDevelopmentInstance`, and it is never registered for test or production
   (ADR-0012, layer 3).
8. **The gate reports; the admin approves.** `validate` runs on the restored records. Its findings
   are part of the plan, because a snapshot that holds the attack must not be restored silently.
   Whether a blocking finding refuses the plan or needs an acknowledgement is open question O3 of
   spec 013.

## Consequences

- A customer gets an hourly configuration recovery point from a scheduler they already run, and
  a rebuild path that ends in update sets their admins review.
- **The recovery point is only as trustworthy as the mirror branch.** snagentic records the
  commit restored. Pushing the branch to a protected, append-only remote, and tagging verified
  snapshots, is the customer's operations. The guide must say so.
- **Restoring data needs matching sys_ids.** References from metadata to data (groups in
  assignment rules, ACL roles) and from data to metadata hold only if both sides keep their
  sys_ids. R1 keeps them by construction; R2 must prove it. The external data tool must keep them too.
- **Incremental pulls have known blind spots** (ADR-0016). A recovery point is trustworthy only after a
  `pull --verify`. The guide recommends one daily.
- New code:
  - a restore context in `core`, with the snapshot comparison as pure domain code;
  - the store application installer (I3);
  - a writer for R1 or a unit generator for R2;
  - one CLI use case.
- **Restoring into production stays impossible**, by construction. If it is ever needed, it is
  a new ADR amending 0012.

## Alternatives considered

- **Adopt from a live instance, then push.** This is today's route. It needs a development
  instance holding the good configuration, which is what was lost.
- **Transform the mirror into Fluent source.** The mirror lacks the reference keys `transform`
  needs (S16 F1), and ADR-0031 already rejected mirroring an instance as Fluent.
- **Capture `sys_update_version` payloads in pull.** The platform's own serialization would give
  the highest fidelity. But every hourly pull would read a large table, payloads hold secrets
  that pull now redacts before writing (ASR-08), and ADR-0018 decided update data is read
  live, not mirrored. It is kept as a fallback if R1's rendering proves unfaithful.
- **Restore directly into production.** Rejected: it would break ADR-0012's guarantee, which
  ADR-0038 already relaxed only for components at parity.
- **Platform clone or backup services.** These are the customer's other tool. They restore an
  instance whole, including the attack if the copy postdates it. snagentic adds a chosen,
  versioned, reviewable configuration point.
