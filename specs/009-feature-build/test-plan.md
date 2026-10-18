# 009. Building ServiceNow features with Fluent through snagentic: test plan

- Status: Draft for the product owner's review
- Date: 2026-10-17
- Builds on: `analysis.md` (per-class routes, bugs, spike S19), `mirror-plan.md` (M1–M5),
  ADR-0031 (Fluent authoring), ADR-0032 (the SDK behind snagentic's connector), ADR-0033 (plans
  compare with the instance), ADR-0034 (what the mirror keeps)
- Replaces: spike S19 in `analysis.md` section 5; its twelve checks are folded in below (tagged
  `S19-n`)

## 1. Goal

Prove, with evidence anyone can re-read, that a developer or an agent can use snagentic to build
a ServiceNow feature in Fluent, from a one-field change to a multi-class feature, for the ten
classes of spec 009: dictionary entries, choices, script includes, inbound email actions, flows,
UI actions, UI policies, modules and menus, roles, ACLs. "Proved" means four things hold:

1. **The data is there.** The mirror holds every record of these classes, as the instance does.
2. **Everything existing can enter Fluent.** Every record is adopted, or refused with a named
   reason and a next step; nothing fails without a reason.
3. **Every change is delivered exactly.** What source says is what the instance holds after a
   push, captured in the update set, with nothing else changed.
4. **The feature works.** The delivered records behave as intended on the instance, and the
   update set moves them to a second instance.

## 2. Claims and how they are shown

| # | Claim | Shown by | Status on 2026-10-17 |
|---|---|---|---|
| F1 | The mirror holds every record of the ten classes, field for field | L0 | UI policies proved (8,780 records, all fields); others offline only |
| F2 | Every existing record adopts, or is refused with a reason | L1 | Sampled: UI policies 11/11, global roles 10/10, policies with empty type 8/8 |
| F3 | Adopted source rebuilds the instance: a push of it changes nothing | L2 | Script include and property only (live round trip) |
| F4 | A single change per class is delivered exactly, captured, read back | L3 | Property and script include only |
| F5 | Child rows, references, deletions, protection and domains behave | L4 | B1–B3 fixed offline; unproven live |
| F6 | A composed feature is delivered in one plan and works | L5 | Not started |
| F7 | Drift, refresh, collisions and second-instance promotion work | L6 | Drift and refresh for a property only |
| F8 | The gate stops what must not ship | L3–L5 negative tests | Rules exist; not run against these classes |
| F9 | An agent with only snagentic's skills does the same | L7 | Not started |
| G2 | The mirror explains an instance: why, where, what breaks | L8 A7 | Not started |
| G3 | Guardrails hold on every surface: local, pull request, update set | L8 A6 | Not started |

## 3. Evidence

Every test leaves an **evidence bundle**, written by the harness, never by hand:

```
evidence/<run id>/<test id>/
  summary.json        test id, claim, pass/fail, timings, snagentic and SDK versions, instance build
  source/             the Fluent files the test wrote or adopted (git diff against its start)
  plan.json           plan-push output: units, operations, losses, gate findings, plan id
  push.json           push output: loaded units, capture check, read-back result
  built/              the built update XML of each unit
  before.json         live copies of the touched units before the push (Table API, all fields)
  after.json          live copies after, and the field-by-field comparison with the build
  update-set.xml      the update set as exported (update-sets export)
  functional.json     the behaviour check (L5): requests made, responses, expected and actual
  cleanup.json        what was deleted afterwards, and the proof it is gone
```

- **Run id**: `<date>-<snagentic version>-<git sha>`; a run is reproducible from its sha.
- **Where**: outside the repository (`spaces/pdi2-evidence/`), as a git repository of its own
  so runs can be compared; each run's `summary.json` files roll up into one report per run.
- **Reading it**: a generated `report.md` per run lists every test with its claim, verdict and
  links to its files. That report is the artefact the product owner reviews.
- **Secrets**: evidence passes through the same redaction as the mirror (ADR-0034) before it
  is written; no credential or session header is ever recorded.

## 4. Environment

- **Instance**: pdi2 (development; the product owner allows tests to write to it),
  release build of snagentic (`dist/snagentic`), SDK 4.13.6.
- **Isolation**: a dedicated scoped application for the tests, `x_2222332_snfx` (created once
  in Studio; until then the S11 application `x_2222332_s11`), plus global
  records only where a test needs global. Every global record a test creates is named
  `snfx_<test id>_…` so the cleanup sweep can find it.
- **Update sets**: each run pushes to `snagentic: snfx-<run id>`; the run's last step exports
  them as evidence, then backs them out.
- **Coordination**: one run at a time. The harness takes a lock on pdi2 (a system property
  `x_2222332_snfx.lock` holding the run id) and refuses to start when another session holds it.
  Pushes switch the user's current application and update set, so no other session pushes to
  pdi2 during a run.
- **Second instance** (L6 promotion): a second PDI, `pdi3`, needed only for F7's promotion
  tests.
- **Users**: the admin credential snagentic uses, and for functional checks one test user per
  role under test (`snfx.itil`, `snfx.approver`), whose credentials live only in the keychain.

## 5. The levels

The levels build on each other: a level runs only when the one before it passes for that class.

### L0. Sync fidelity (F1), read-only

For each class: list the instance's records by sys_id across all domains, compare with the
mirror (missing, extra), then compare **every field of every record** with the mirror, scripts
included. Records changed since the last pull are counted apart, not failed.

| ID | Class(es) | pdi2 records | Pass when |
|---|---|---|---|
| L0-1 | UI policies, actions, related-list actions, catalog UI policies and actions | 8,780 | **Passed 2026-10-17**: 0 missing, 0 extra, 0 field differences |
| L0-2 | UI actions, roles and views; declarative actions | 2,763 + 808 + 673 | 0 missing, 0 extra, 0 differences |
| L0-3 | Menus, modules | 217 + 3,014 | same |
| L0-4 | Roles, containments | 822 + 1,050 | same |
| L0-5 | ACLs, ACL roles, security attributes | 49,948 + 47,971 + 4,750 | same (sampled 5,000 if the full run exceeds an hour) |
| L0-6 | Dictionary, overrides, choice sets, choices | 143,359 + 466 + 4,031 + choices | same; choices of variables per M3 |
| L0-7 | Script includes with ES-latest rows | 5,798 + 1,224 | same; protected records counted apart |
| L0-8 | Inbound email actions; the email receiving property | 16 | same; property value present (M2) |
| L0-9 | Flows, actions and their child rows | 404 + 588 | same, v1 and v2 child tables |
| L0-10 | References out of each class resolve in the mirror | all | every reference resolves, or the target is missing on the instance too |

Evidence: per class, the counts, the list of any difference, and the script's output.

### L1. Adopt census (F2), read-only

For each class, every record of a chosen population is converted, built and compared with its
live copy, exactly as `adopt` does, without writing source. Each record ends in one bucket:

- **adoptable**: no difference, or only named losses (which ones, how many);
- **refused, by design**: a named refusal with a next step (protected code, empty script
  include access, a UI policy for all UIs with scripts off, a store application, domain choices);
- **failing**: anything else. A failing record is a bug: it gets an issue, a recorded fixture
  and a fix, as X4 did.

| ID | Class | Population | Pass when |
|---|---|---|---|
| L1-1 | UI policies | all 3,035 | 0 failing |
| L1-2 | UI actions | all 2,763 | 0 failing (workspace-flag case: a refusal with a reason) |
| L1-3 | Script includes | all 5,798 | 0 failing; 273 protected and 47 empty-access refused |
| L1-4 | Roles | all 822 | 0 failing |
| L1-5 | ACLs | 2,000 sampled across operations and types, plus all 56 advanced-without-script | 0 failing |
| L1-6 | Dictionary and choices | the 50 tables with most custom columns | 0 failing |
| L1-7 | Modules and menus | all | 0 failing |
| L1-8 | Inbound email actions | all 16 | 0 failing |
| L1-9 | Flows and actions | all v2, unprotected | 0 failing |

Evidence: per class, bucket counts, every refusal reason with its count, every named loss with
its count, and the recorded fixture of each failure found. The adoptable share per class is the
headline number for F2.

### L2. No-op round trip (F3), writes nothing on the instance

Adopt a set of real records per class into a scratch workspace, commit, then `plan-push`.

| ID | What | Pass when |
|---|---|---|
| L2-1 | 20 records per class, mixed scopes, adopted into `source/global` and scoped projects | plan has no `load`, `create` or `delete`; only `record` operations; no gate finding |
| L2-2 | The same, built on Linux and Windows (CI matrix) | the plan id is identical on every platform |
| L2-3 | Push the no-op plan anyway | nothing is loaded; the update set stays empty |

### L3. Single changes per class (F4, F8)

In `x_2222332_snfx` unless noted. Each row is one test: create, change, delete, each pushed
separately. After every push the harness compares the live copy with the build, field by field,
and checks the update set holds exactly the units planned.

| ID | Class | Create | Change | Delete | Negative (gate or refusal) |
|---|---|---|---|---|---|
| L3-1 | Table and columns | table, 5 typed columns | label, max length, default | a column (`Now.del`) | a reference with no qualifier on a large table |
| L3-2 | Choices | a choice set with 3 choices | add one, reorder, relabel | one choice | a choice deleted that records use (warning) |
| L3-3 | Script include | with `Now.include` file | script body, `accessibleFrom`, `protectionPolicy` (S19-4), `useEsLatest` | `Now.del` | `eval`, `GlideRecord` in a loop (rule) |
| L3-4 | Inbound email action | on `x_..._request` | condition, script | `Now.del` | script with a hard-coded address (rule) |
| L3-5 | UI action | form button with `roles: ['itil']` (S19-1) | label, condition, script | `Now.del` | client script calling server code synchronously |
| L3-6 | UI policy | 2 actions | condition, action visibility | an action (B2), the policy | a policy with an empty condition |
| L3-7 | Module and menu | menu with 2 modules (`Record()`) | order, roles | a module | — |
| L3-8 | Role | role with one contained role | description, `elevatedPrivilege` | a containment (B2) | containing `admin` (blocked) |
| L3-9 | ACL | read ACL with a role (S19-1) | condition, add a role | remove a role (B2, S19-2) | unrestricted read on a table (blocked) |
| L3-10 | Flow | record-triggered flow with one action | add a step | `Now.del` | flow running as system without a reason |
| L3-11 | Global dictionary on a baseline table | `u_snfx` on `incident` via `Record()` (S19-5) | label | `Now.del` | `augments` refused |
| L3-12 | Choice on a baseline field | one choice on `incident.category` (S19-6) | relabel | delete it | every baseline choice must remain |

Pass when, for every row: the plan names exactly the intended units and losses; push loads
them; the read-back equals the build; the update set contains them and nothing else; the delete
leaves no row and is captured; the negative case is blocked or refused with its rule id.

### L4. Relationships and edge cases (F5)

| ID | What | Pass when |
|---|---|---|
| L4-1 | Roles and views named in source with no `keys.ts` entry (S19-1, B3) | rows hold the real sys_ids; plan after push is empty |
| L4-2 | Remove a role from `roles[]` (S19-2, B2) | plan refuses, naming the `Now.del`; with it, the row is gone and captured |
| L4-3 | Change only `protectionPolicy`, then only `useEsLatest` (S19-4, B1) | each is planned and delivered alone; the script is unchanged |
| L4-4 | `Now.del` by keys of a dictionary override, an ACL role, a choice (S19-9) | the right row is deleted and recorded |
| L4-5 | New global ACL on `incident` as admin without `security_admin` (S19-3) | created and captured, or a failed load; never partial |
| L4-6 | Adopt a baseline global role, push unchanged (S19-8) | nothing loaded; `suffix` unchanged |
| L4-7 | Scoped module in the baseline Incident menu (S19-11) | visible in the navigator; captured in the scoped set |
| L4-8 | Inbound action override in a child domain (S19-12) | a new override; the parent untouched |
| L4-9 | Adopt and push a published v2 flow unchanged (S19-10) | still published, snapshot clean, a test record runs it |
| L4-10 | Cross-project references: a scoped UI action using a global script include | both build; references resolve; push order correct |

### L5. Features, simple to complex (F6)

Each feature is built from an empty project as one change, planned once, pushed once, then
checked **functionally**: by its behaviour, not by its records.

| ID | Feature | Classes | Functional check |
|---|---|---|---|
| L5-1 | **Simple**: a "Request type" field with choices on a custom table, shown on the form | table, columns, choices, form layout | a record created with each choice reads back; the form layout lists the field |
| L5-2 | **Small**: an approval role and an ACL limiting who may update a field | role, ACL, ACL role | as `snfx.itil` the update is refused (403); as `snfx.approver` it succeeds |
| L5-3 | **Medium**: "Escalate" UI action, a UI policy making the reason mandatory when escalated, a script include doing the escalation | UI action, UI policy, script include, role | calling the script include through the UI action's server path escalates a record; the UI policy's rule is checked in a browser run (L5 browser evidence) |
| L5-4 | **Medium+**: an application menu with modules for the new table, roles on modules | menu, modules, roles | navigator shows the menu to the right role only (browser) |
| L5-5 | **Complex**: "Request by email": an inbound email action creates a request, a flow assigns it and notifies, a script include computes the priority, ACLs and roles guard it | inbound action, flow, script include, ACL, role, table, choices | an inbound email record (`sys_email`, type received) creates a request with the computed priority, assigned by the flow, within 60 s |
| L5-6 | **Complex, change**: modify L5-5: new choice, changed priority rule, one role removed | all above | only the changed units load; behaviour reflects the change; the removed role's grant is gone |
| L5-7 | **Removal**: delete L5-5 entirely through source | all above | every unit deleted and captured; nothing of the feature remains |

**Browser evidence** for client-side behaviour (UI policies, UI actions, menus): a recorded
browser run (screenshots and a short recording) on the instance as the test user, saved in the
bundle. This is evidence only; the pass verdict comes from the server-side check where one
exists.

### L6. Lifecycle (F7)

| ID | What | Pass when |
|---|---|---|
| L6-1 | Edit an adopted record in the instance's form, then plan | drift refused, naming `adopt --refresh` |
| L6-2 | `adopt --refresh` with local edits on another field | both changes kept; conflicts only on the same lines |
| L6-3 | Another user's open update set holds a unit | plan lists the collision; push refuses without `--allow-collisions` |
| L6-4 | Interrupt a push between loads (kill the process) | the next plan sees the partial state; nothing duplicated |
| L6-5 | Promote L5-5's update sets to `pdi3` (export, import, preview, commit) | preview clean; the functional check passes on `pdi3` |
| L6-6 | Back out L5-5's update sets on pdi2 | the instance returns to its state before L5-5 |

### L7. Agents (F9)

Run L5-1, L5-3 and L5-5 through the evaluation harness (`scripts/eval/run.ts`) with a coding
agent that has only snagentic's skills and instructions, three repetitions each.

| ID | Pass when |
|---|---|
| L7-1 | each feature reaches a passing L5 functional check in at least 2 of 3 runs |
| L7-2 | no run pushes without a plan the harness approved; no run writes outside `source/` |
| L7-3 | the gate's findings during the runs are recorded; each one the agent ignored is a defect |

### L8. Scenarios: the levels composed, and the two goals they leave out

Added 2026-10-18, after 2.2.0 proved phases 1–2. Each scenario reuses the L3 harness and is
judged by behaviour, as L5 is. A1, A3 and A4 compose L5 and L6; A2, A6 and A7 cover what L0–L7
don't: changes to baseline records already customised, guardrails on every surface (goal 3), and
audit and troubleshooting (goal 2).

| ID | Scenario | Composes | Pass when |
|---|---|---|---|
| A1 | **New scoped app, one plan**: "Request by email" from an empty project: table, typed columns, choices, form and list layout, two roles, ACLs (elevated session), UI action, UI policy, script include, inbound email action, record-triggered flow, menu and modules | L5-1 to L5-5 | one plan, one push, nothing refused; an inbound `sys_email` creates a request with the computed priority, assigned by the flow within 60 s; `snfx.itil` gets 403 where `snfx.approver` succeeds; the menu shows to the right role only (browser evidence) |
| A2 | **Change baseline Incident in global**: adopt incident UI policies and business rules, edit two; add `u_snfx_*` columns through `Record()`; add a choice on `incident.category`; a scoped module in the baseline Incident menu | L3-11, L3-12, L4-6, L4-7 | only the edited units load; findings the adopted code already had are inherited, never blocking (decision D); the incident form behaves as changed; every baseline choice remains |
| A3 | **Change, then remove A1**: a new choice, a changed priority rule, one role removed; then the whole feature deleted from source | L5-6, L5-7, L4-2 | only changed units load; the removed role's grant is gone; after removal nothing of A1 remains and every delete is captured |
| A4 | **Team work**: a colleague edits an adopted record in its form; another user's open update set holds a unit; a push is killed between loads | L6-1 to L6-4 | drift refused naming `adopt --refresh`; refresh keeps both edits; collision listed and refused; the next plan after the kill sees the partial state and duplicates nothing |
| A5 | **Promotion**: A1's update sets moved to `pdi3`, registered as kind `test`, then backed out on pdi2 | L6-5, L6-6 | on pdi3 write use cases are absent and a credential with write roles is refused (ADR-0012); preview is clean; A1's functional check passes there; backout returns pdi2 to its state before A1 |
| A6 | **Guardrails red team**: one change set of deliberate violations (`eval`, `GlideRecord` in a loop, a hard-coded credential, an unrestricted read ACL, a role containing `admin`, a flow running as system) sent through local `validate`, a pull request (CI, SARIF), and an update set made by hand on the instance | F8 across surfaces | each violation is blocked or reported with its rule id on every surface; the credential is never written to disk, the mirror or evidence |
| A7 | **Audit and troubleshoot**: defects planted on pdi2 (an ACL hiding a field from `itil`, a business rule overriding assignment, a script include nothing calls), then questions: why can't itil edit the field, why did this incident go to that group, what breaks if this role goes | goal 2 | each answer cites the planted records (sys_id and file) and no unrelated one; impact lists every dependant the graph holds |
| A8 | **Agents only**: A1, A2 and A6 through `scripts/eval/run.ts`, three runs each, with only snagentic's skills | L7 | as L7-1 to L7-3 |

Order: L3 (as the harness smoke test), A1, A3, A2, A4, A6, A7, A5, A8. Every failure is fixed
test-first in its own pull request before the scenario continues.

Defaults taken for section 8 when the scenarios were added (owner: "go for it", 2026-10-18):
removed children stay written by the developer (decision 1, today's behaviour, so the plan's
refusal naming the `Now.del` is the expected result); the harness creates the test users on
pdi2 (decision 6); `pdi3` isn't available yet, so A5 waits (decision 5); the run lock of
section 4 coordinates with the accelerator session that also writes to pdi2.

### L8 run 1: results (2026-10-18, pdi2, snagentic main + fixes)

Run from source on branch `run/l8` (main at 1767dd1 plus the fix pull requests below), in a new
workspace with no pull (`spaces/pdi2-snfx`, branch `snfx/a1-app`); every step is a commit there.
The application `x_2222332_snfx` was itself created by a push (`Record()` on `sys_app` in
global), then its records were authored in `source/x_2222332_snfx`.

| Check | Result | Evidence or fix |
|---|---|---|
| New application by push | pass | one unit, captured, read back |
| L3-1 table, 8 typed columns: create | pass after fix | collection row not applied: #100 |
| L3-1 change label, length, default | pass after fix | the platform drops any update of a column with no `maxLength` ("Length change not allowed", syslog) while the load answers success: plan refuses it, #103 (SDK issue 10) |
| L3-1 delete a column | **fails, open** | in a scoped project that defines the table, `Now.del` by keys builds nothing; by sys_id it builds a DELETE named `sys_dictionary_undefined_null` with no table or element. Needs a decision (snagentic writing the deletion, decision 1) |
| L3-2 choices: create, reorder, relabel, add, remove | pass | the choice set loads whole; the removed row is gone |
| L3-3 script include: create, body, access, ES latest | pass | |
| L3-3 `protectionPolicy` | **fails, open** | the load drops `sys_policy`: neither applied nor in the captured update (`<sys_policy/>`); a form edit is captured with it. B1's comparison is right; delivery isn't |
| L3-3 negative: `eval` and a GlideRecord query in a loop | pass after fix | the plan's gate checked nothing in a workspace with no pull: `ready` with `eval`. #102 |
| L3-8 roles: create with containment, description, elevated | pass | containments resolve on the instance |
| L3-8 remove a containment (B2) | pass | plan names the `Now.del`; deleted and captured as DELETE |
| L3-9 ACLs through the elevated session | pass | 3 ACLs, 3 roles; read and field write checked as three users |
| L3-10 flow: create, change | pass after fix | a record trigger with an empty condition never runs (no context, no log); `^EQ` runs in 10 s. SN-MNT-018, #104 (SDK issue 11) |
| A1 one plan: menu, 2 modules, form, list, UI action with role, UI policy, inbound action, flow | pass | 12 units in one push, plan empty after |
| A1 functional: email to routed request | pass | `sys_email` + `email.read`: request with type, requester and computed priority, routed by the flow |
| A1 functional: ACLs per role | pass | no role: 404; agent: reads, can't set `urgent`; approver: sets it |
| A1 functional: UI action, UI policy, menu | not yet run | browser evidence |
| A3 change: new choice, priority rule, role removed from a UI action (B2), intake script | pass | only the changed units load; the role row is deleted and captured; a training email scores 5 |
| A2 adopt a baseline business rule and UI policy (22 actions); no-op plan | pass | 6 s; the plan after adoption is empty |
| A2 edit both; `u_` column on incident by `Record()`; module in the baseline Incident menu | pass | |
| A2 a choice on `incident.category` by `Record({ table: 'sys_choice' })` | **refused after fix** | the build names a lone choice `sys_choice_incident_category`, the whole list's update name: committed, it would remove the other categories. Plan refuses it, #107; nothing changed on pdi2 |
| A2 the same choice through the adopted choice set | pass | all 6 baseline categories kept, the new one added |
| A4 drift after a form edit; refresh keeps both sides (L6-1, L6-2) | pass | a direct edit is refused as drift; `adopt --refresh` merges it |
| A4 a record in another open update set (L6-3) | pass | the Default set's entry is listed; not ready without `--allow-collisions` |
| A4 push killed between the two projects' loads (L6-4) | pass | `status` names the stopped push; the next plan records the loaded unit and loads the other; the user's update set and application are restored from the journal |
| A6 red team: validate, plan gate, push, CI exit code | pass for 7 of 7 existing rules | `eval`, credential (evidence redacted), `Packages.*`, `current.update()` before, GlideRecord and DOM in a client script, unrestricted write ACL; push with the plan id an error reveals still refuses |
| A6 a role containing `admin` | **blocked after fix** | passed every check: SN-SEC-009, #108 |
| A6 an unrestricted read ACL; a flow as system with no reason | not covered | no rule; SN-SEC-006 covers write, create and delete only |
| A6 update set validation | **not built** | goal 3 and ADR-0010 item 5 name it; the roadmap in `docs/product/overview.md` still says 1.3 and calls 1.1 "this release" |

Also found, not fixed:

- `InboundEmailAction` is inactive unless `active: true` (the SDK's documented default): the first
  A1 email went to "Create Incident". Guidance, or a warning rule, should say so.
- Dictionary units are all named after their table in plans (`x_2222332_snfx_request` for every
  column); `table.element` would tell them apart.
- Push calls a unit captured when an earlier update of it is in the set; the read-back still
  reports the unit as not applied, so nothing is lost.
- Test users need `web_service_access_only` on a PDI with multi-factor authentication.

## 6. Harness

- `tests/live/feature/` holds one file per level, driven through the CLI from source as
  `tests/live/fluent-round-trip.test.ts` is, opt-in with `SNAGENTIC_LIVE_INSTANCE`.
- One shared helper writes the evidence bundle; one cleans up by run id and proves it.
- L0 and L1 run `tests/live/verify/sync-fidelity.ts` and `tests/live/verify/adopt-census.ts`
  (read-only on the instance; type-checked and linted with the code). Both were calibrated
  against known results before use: L0-1 reproduced the ad-hoc check (8,780 records, no
  difference); a mirror pulled before 2.1 reported all 4,970 ES-latest rows missing; the census
  without PR #79 reported every global role failing on `suffix`.
- Each level's run produces `report.md`; the plan's status table (section 2) is updated from it
  in the pull request that records the run.

## 7. Order and gates

| Phase | Levels | Entry | Exit (gate to next phase) |
|---|---|---|---|
| 1 | L0 all classes | none | 0 unexplained differences |
| 2 | L1 all classes | phase 1 | 0 failing records; each refusal reviewed |
| 3 | L2, L3 | phase 2 for the class | all rows pass on pdi2 |
| 4 | L4 | phase 3; open decisions below taken | all rows pass |
| 5 | L5-1 to L5-4 | phase 4 | functional checks pass |
| 6 | L5-5 to L5-7, L6 | phase 5; `pdi3` available | functional checks pass on both instances |
| 7 | L7 | phase 6 | thresholds met |
| 8 | L8 (A1–A4, A6, A7 after their levels; A5 with `pdi3`; A8 last) | as each scenario says | each scenario passes |

Phases 1–2 are read-only and can start at once. Every failure found is fixed test-first in its
own pull request before the phase continues; the evidence of the failing run is kept beside the
fix.

## 8. Decisions needed before phase 4

1. **Removed children (B2)**: snagentic emits the `Now.del` itself, or the developer writes it
   (today). L3-6, L3-8, L3-9, L4-2 and L5-6 expect whichever is chosen.
2. **Protected records**: refuse in adopt (recommended), as L1-3 expects.
3. **Baseline records**: edit in place only through `Record()` in global (recommended); L3-11,
   L3-12 and L4-7 follow it.
4. **Evidence store**: `spaces/pdi2-evidence/` as its own git repository (proposed), or an
   artifact store.
5. **Second instance** `pdi3` for L6-5.
6. **Test users** `snfx.itil` and `snfx.approver` on pdi2, created once by the harness.

## 8b. Decisions taken while running phases 1–2 (2026-10-17)

- Menus with an empty order: accepted as a known loss, order 100, named in every plan (B).
- Protected roles and UI policies whose child rows' protection the SDK would change: refused,
  named.
- **D. The gate's scope:** a plan's gate judges what the change introduced since each project's
  ledger commit; findings an edited record already had are inherited, shown, never blocking
  (option 3). `validate` on its own (CI on pull requests) still judges against the base it is
  given.

## 9. What this plan does not cover

- Production and test instances (write use cases are absent there by design, ADR-0012).
- Performance at scale beyond the counts above (ASR-07 has its own measures).
- Classes outside spec 009's ten (notifications appear only as part of L5-5).
