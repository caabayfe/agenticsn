# 013. Configuration restore through the Fluent install route: plan

- Status: Draft (2026-10-27). Spikes RF-1 to RF-5 not run; O1–O5 open
- Date: 2026-10-27
- Decision: ADR-0045 (proposed), amending ADR-0010
- Builds on: ADR-0031 (Fluent authoring), ADR-0033 (plans and ledgers), ADR-0038 and spec 011
  (install runner, component installer, take-over; spike S-F: the store application API)

## 1. Goal

Rebuild a customer's configuration on a fresh development instance (a subprod instance registered
as `development`), from a known-good commit of its Fluent source, with the same route that
installs accelerator modules:

1. **bootstrap:** adopt the customer-changed configuration once, from a development clone of
   production;
2. **restore:**
   1. install the components;
   2. take over out-of-box records;
   3. push each scope into its own update set;
   4. pull and report.

An external scheduler runs the hourly pulls of production (read-only). Another tool restores
data and secrets. Test and production are never written (ADR-0012).

## 2. Where we start

| Need | Today |
|---|---|
| Fluent source of a record | `adopt <records...> --instance <development>` |
| Select every customer-changed record of a scope | **None**. `take-over` has the test: an update name with a customer update in `sys_update_xml` |
| Report what adopt refuses, across a scope | **None**. Adopt refuses with a reason per record |
| Create on a fresh instance | Plan decides `create` for a unit the instance doesn't hold |
| Out-of-box records the source declares | `take-over` (refuses records customized on the target) |
| Install from one approved plan | `accelerator install`: components, pull, take-over, push per module, journal, resume |
| Install content other than a pack | **None** |
| Components at parity with another instance | Plugins only, from a development install's journal (ADR-0038, section 5); store applications not built (I3) |

## 3. Spikes

| Id | Question | Decides | Passes when |
|---|---|---|---|
| RF-1 | **Clone.** Does a clone of production to a development instance keep the customer update records (`sys_update_xml`, `sys_update_version`) that select customer-changed records? What clone exclusions affect them? | Selector | The selector finds the same records on the clone as on the source |
| RF-2 | **Bootstrap coverage.** On a realistic instance, adopt every customer-changed record of global and of one custom scope: refusals by reason, duration, requests | Viability; the fallback | The owner accepts the coverage. The report names every refusal |
| RF-3 | **Restore to a fresh PDI.** Push the adopted source with create and take-over. Compare a pull of the target with the source's mirror for the adopted records | Viability | Equal, apart from known SDK losses; sys_ids kept, apart from those the platform ignores (dictionary entries, choices, form elements) |
| RF-4 | **Scale.** Units per minute and update set size for the RF-2 workspace (baseline: 262 units in 2 minutes 9 seconds) | Batching | Within the ADR-0016 budgets |
| RF-5 | **Store applications at a pinned version.** Does `app_repo/install` install the snapshot's version when a newer one exists? | Component step | Installs, or refuses with a reason |

## 4. Open questions for the product owner

| Id | Question | Proposed answer |
|---|---|---|
| O1 | A command of its own, or the install runner with the workspace as content? | `restore <instance> --commit <c>`, a thin use case on the runner. The plan and report read as a restore, not a pack |
| O2 | How does source stay current? | All changes through the development flow, plus `adopt --refresh` on a fresh clone after every release, and monthly |
| O3 | Records adopt refuses: what happens to them? | A manual runbook from the coverage report. A fallback route (ADR-0045 alternatives) only if RF-2's coverage is too low |
| O4 | Custom scoped applications: adopt or install from the company app repository? | Adopt as source (ADR-0031 supports them); app repository only for applications built elsewhere |
| O5 | Customizations to store application scopes? | Excluded in the first release, listed in the coverage report |

## 5. Steps

Effort: S under 1 day, M 1 to 3 days, L over 3 days.

| # | Step | Tested with | Effort | Needs |
|---|---|---|---|---|
| C1 | Store application installer (I3 of spec 011) | Fake CI/CD API: lost response read, never re-requested; demo data never requested | M | RF-5 |
| C2 | Components from a mirrored inventory at a commit: the source's active plugins and store applications minus the target's, in dependency order, versions pinned | Unit tests on inventory fixtures | S | — |
| A1 | `adopt --customized --scope <s>`: selects customer-changed records with the `take-over` test, in batches through the scheduler | Fake reader; the batch boundaries | M | RF-1 |
| A2 | Coverage report: adopted, refused by reason, store application scopes left out | Golden file | S | A1 |
| I1 | Install runner content source: the workspace's projects at a commit, one module per scope; take-over list from the source's out-of-box units the target holds | The runner's fakes (`install-fakes.ts`) | M | — |
| U1 | `restore` use case (CLI only, destructive, `requiresDevelopmentInstance`, not MCP) on the runner: plan, `--confirm`, journal, resume, lock | Registry tests; absent for test and production | S | C1, C2, I1 |
| D1 | Guide: bootstrap, keeping source current, hourly pulls, protecting the git remote, the drill | — | S | U1 |
| L1 | Live drill: bootstrap on pdi2, restore to a fresh PDI, verify; measure RTO | Opt-in live test | M | U1 |

Order:

1. RF-1, RF-2 and RF-5 first: they decide whether the route holds.
2. C2 and I1 in parallel (no spike needed).
3. A1, A2, C1.
4. U1, D1, L1.

## 6. Acceptance

- On a fresh PDI, `restore --confirm` installs the components and pushes the source at the
  chosen commit into update sets. Once they are committed, a pull of the target matches the
  source instance's mirror for every adopted record, apart from known SDK losses.
- Adopted records keep their sys_ids, apart from those the platform ignores.
- No write happens outside the component installer, take-over and push.
- `restore` is absent for test and production instances, and is not an MCP tool.
- RF-2's coverage and L1's RTO are recorded in `docs/reports/`.

## 7. Out of scope

- Business data, attachments, users and groups, CMDB, audit history (the customer's tool).
- Credentials, certificates, encryption keys, redacted property values (the customer's vault).
- Reading production for adopt, and writing to test or production.
- A second write route; the alternatives in ADR-0045 wait for RF-2.
- Scheduling pulls and protecting the git remote (the customer's operations; D1 documents them).
