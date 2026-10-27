# 013. Configuration restore from a mirror snapshot: plan

- Status: Draft (2026-10-27). Spikes RS-1 to RS-6 not run; O1–O5 open
- Date: 2026-10-27
- Decision: ADR-0045 (proposed), amending ADR-0010 and ADR-0031
- Builds on: ADR-0018 (update set XML rendered from reads), ADR-0038 (component installer, plan
  and confirm, journal), spec 011 (spike S-F: the store application API)

## 1. Goal

From a chosen commit of an instance's mirror branch, rebuild that instance's configuration on a
fresh development instance (a subprod instance registered as `development`):

1. install the plugins and store applications the snapshot lists;
2. write the configuration that differs into update sets an admin reviews and commits;
3. prove afterwards that the target matches the snapshot, apart from named exclusions.

An external scheduler runs the hourly pulls, and another tool restores the business data. Test
and production are never written (ADR-0012).

## 2. Where we start

| Need | Today |
|---|---|
| Hourly snapshot of metadata | `pull` (incremental, 22 requests when idle); `pull --verify` reconciles by counts |
| Snapshot of components | `operational/plugins.yaml` (id, active, version), `store_apps.yaml` (scope, version, vendor, source) |
| Install plugins | Component installer, ADR-0038, section 4 (CI/CD API, journaled, never retried) |
| Install store applications | API known (S-F: `POST /api/sn_cicd/app_repo/install`); installer I3 **not built** |
| Release of the snapshot | **Not recorded** in a form `restore` can compare (RS-6) |
| Compare two mirrors | **None**: integrate and the plan compare source with one instance |
| Write a snapshot to an instance | **None**: push needs adopted Fluent source, which needs a live source instance |
| Update set XML | Rendered from reads for `update-sets export` (ADR-0018) |

## 3. Spikes

Each spike runs on two PDIs of the same release: a source with a known customer configuration
and a fresh target. The same sample is used throughout:

- a script include and a business rule;
- an ACL with roles;
- a dictionary entry with choices;
- a form and a list layout;
- a UI policy with actions;
- a system property;
- a flow;
- a record in a custom scoped application;
- the deletion of an out-of-box record.

| Id | Question | Decides | Passes when |
|---|---|---|---|
| RS-1 | **R1, rendered remote update sets.** Can update XML rendered from the mirror's YAML (heads and child rows) be loaded into a retrieved update set, previewed and committed on the target, with no preview problems from the rendering? | Route | Commit succeeds; a pull of the target equals the snapshot for the sample, sys_ids included |
| RS-2 | **R2, `Record()` units through push.** Does a generated `Record()` unit per sample record, with `$id` and raw values, load, get captured and read back equal? What does the SDK change (ADR-0031 losses)? | Route | Same pull comparison; every difference named |
| RS-3 | **Composite records.** For the layouts, choice lists and UI policy, which update names and payload shapes does the platform expect? Does R1's rendering reproduce them? | R1 fidelity | Rendered XML matches an `update-sets export` of the same change, after normalization |
| RS-4 | **Flows.** Does a restored flow need publishing (ADR-0028)? By which route? | Route; step order | The flow runs on the target |
| RS-5 | **Scale.** A snapshot with 5,000 changed records: duration, requests, update set size, preview time; batch size per set | Batching | Within the ADR-0016 budgets, or a measured reason to raise them |
| RS-6 | **Release and components.** Where does the target report its family and build (read-only, indexed)? Do store application versions from the snapshot install when newer ones exist? | Decision 4; component step | One request reads the build; pinned versions install or are refused with a reason |

## 4. Open questions for the product owner

| Id | Question | Proposed answer |
|---|---|---|
| O1 | Which route, R1 or R2? | R1 if RS-1 and RS-3 pass: it keeps sys_ids, uses the platform's preview, and doesn't misuse `Record()` |
| O2 | Restore deletions of out-of-box records? | Yes, listed in the plan, each with its record; the admin may drop them |
| O3 | A blocking gate finding in the snapshot: refuse, or acknowledge? | Acknowledge in the plan (the plan id covers the findings); refusing would block restoring a customer's own history |
| O4 | Customer-built scoped applications: restore as metadata, or install from the company app repository? | Metadata by default; app repository when `store_apps.yaml` says `source` is the repository and the version exists there |
| O5 | Restore records of store application scopes the customer changed? | Not in the first release: list them as exclusions |

## 5. Steps

Effort: S under 1 day, M 1 to 3 days, L over 3 days.

| # | Step | Tested with | Effort | Needs |
|---|---|---|---|---|
| C1 | Store application installer (I3 of spec 011), beside the plugin activator | Fake CI/CD API: lost response read, never re-requested; demo data never requested | M | — |
| C2 | Components plan from a snapshot: the snapshot's active components minus the target's, in dependency order, versions pinned | Unit tests on inventory fixtures | S | RS-6 |
| C3 | Release recorded by pull and checked by restore | Pull golden files; refusal test | S | RS-6 |
| P1 | Snapshot comparison (pure): two mirrors → create, update, delete per record and scope, exclusions with reasons | `fast-check`: comparing a mirror with itself is empty; applying the plan gives the snapshot | M | — |
| P2 | Restore plan document and plan id (as ADR-0038, section 3), with the vault checklist and gate findings | Golden files | M | P1, O3 |
| W1 | Writer for the chosen route: R1 renders and loads remote update sets; R2 generates units and delivers them through push | R1: the ADR-0018 rendering tests and `msw`; R2: the existing push fakes | L | O1, RS-1–RS-5 |
| V1 | Verification: pull the target, compare with the snapshot, report the differences outside exclusions | Fake mirrors | S | P1 |
| U1 | `restore` use case (CLI only, destructive, `requiresDevelopmentInstance`, not MCP): plan, `--confirm <plan id>`, journal, resume, one restore per instance | Registry tests; absent for test and production | M | C1–W1 |
| D1 | Guide: scheduled pulls, daily `--verify`, protecting the mirror branch, the drill | — | S | U1 |
| L1 | Live drill on two PDIs: snapshot, "attack", restore, verify; measure RTO | Opt-in live test | M | U1 |

Order: the spikes first, then C1–C3 and P1 in parallel (they don't depend on the route), then
W1, U1, V1, D1 and L1.

## 6. Acceptance

- On a fresh PDI of the same release, `restore` with an approved plan installs the components
  and writes update sets that, once committed, make a pull of the target equal to the
  snapshot, apart from the listed exclusions.
- Every record that kept its sys_id on the source keeps it on the target.
- `restore` is absent for test and production instances, and is not an MCP tool.
- An interrupted restore resumes with the same command and resends nothing blindly.
- The drill's RTO and request counts are recorded in `docs/reports/`.

## 7. Out of scope

- Business data, attachments, users and groups, CMDB, audit history (restored by the customer's tool).
- Credentials, certificates, encryption keys and redacted property values: the plan lists them
  for the vault.
- Scheduling pulls, retaining snapshots and protecting the mirror remote (the customer's
  operations; D1 documents them).
- Restoring to a target of another release.
- Writing to test or production.
