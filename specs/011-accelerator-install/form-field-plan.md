# Ensure rules, second kind: fields on shipped forms (ADR-0042 `form_field`)

- Status: plan, for the owner's review (2026-10-25); spikes S-FF1, S-FF2, S-FF3 and S-FF5 passed on pdi2
  the same day, S-FF4 partly (section 5.1)
- Decision: ADR-0042 (accepted 2026-10-22) already lists `form_field`; this plan is its build. No
  new ADR unless the owner changes a decision in section 7.
- Builds on: I10 `related_list` (built), F6 take-over, F7 sections matched by caption, F13 and I13
  (deliver a layout whole, as the platform records it), ADR-0038 (scope follows owner)

## 1. Why it matters now

A module can add a column to a shipped table, but it cannot put that column on a shipped form. The
ITSM pack hit this on every process on 2026-10-25:

| Module | Field | Form and view | Effect today |
|---|---|---|---|
| problem-rca | `problem_task.u_acc_rca_method` | problem task, Default view | the method template cannot be used: the field is not on the form |
| request-portal | `sc_task.comments` | catalog task, Service Operations Workspace (`sow`) | workspace fulfillers have no compose for the requester; an interim action asks for the text instead |
| request-fulfilment, request-quality, request-metrics | `sc_req_item.u_acc_promised_date`, `u_acc_awaiting_reason`, `u_acc_closure_code`, `u_acc_incident`, `u_acc_first_time_right` | requested item, Default and `sow` | agents cannot see or set them on the form |
| request-quality | `sc_task.u_acc_awaiting_reason` | catalog task, Default and `sow` | the wait can only be set through the list or the API |
| problem-fix, problem-impact, problem-review, problem-rca | `problem.u_acc_watch_until`, `u_acc_recurrence`, `u_acc_ready_to_close`, `u_acc_score`, `u_acc_risk_review_date`, `u_acc_board_decision`, `u_acc_root_cause_ci` | problem, Default and `sow` | invisible unless an admin edits the form layout by hand |

The only way around it today is the SDK's whole-form `Form()` after a take-over (incident-task does
this for the incident task's `sow` view). That restates every section of the form, so it belongs to
one module, replaces the client's and the platform's layout, and breaks when a plugin changes the
form. ADR-0042 rejected it for shared layouts.

## 2. What the platform does (facts this design rests on)

- **A form** is `sys_ui_form` (table, view, domain) with ordered `sys_ui_form_section` rows. **A
  section** is `sys_ui_section` (name = table, view, caption, domain) with ordered `sys_ui_element`
  rows (`element`, `type`, `position`; `.split`, `.end_split` and `.begin_split` mark columns,
  formatters and annotations are elements too).
- **A section and its elements are one update** (snagentic `unit-specs.ts`: `sys_ui_section`,
  children `sys_ui_element`, ordered). Committing that update replaces the section's whole element
  list, as a choice list does (the lone-choice refusal, spec 009 L8 A2). So adding one field means
  delivering the section **whole**: every element it has now, plus ours.
- **Workspace forms are views.** Service Operations Workspace uses the view `sow`
  (`f5c0a49877413010dc2c885d9f5a999e`) for incident, incident task and catalog task. Its sections
  belong to the workspace application's scope (for example `sn_sow_inc`, `sn_sow_req`), so a
  module's changes go into that scope's project (ADR-0038, scope follows owner; spike S-E passed).
- **The workspace compose follows the form.** incident-task put Additional comments in the `sow`
  view's Notes section, and the workspace's compose area then offered comments. This is the fix for
  the catalog task gap.
- **The platform matches sections by caption** (F7), and **refuses to update or delete a single
  layout entry through `fluent/load`** (F13: "invalid scope"), which is why I13 delivers layouts
  whole.
- **Domains:** on a domain-separated instance a form can have sections per domain (pdi2 has
  `sys_domain` on sections). The related-list kind targets the global domain; the same applies here
  unless S-FF4 shows otherwise.

## 3. What a module declares

In `modules/<m>/ensure.yaml`, next to its `related_list` facts:

```yaml
- kind: form_field
  table: problem_task
  view: Default view          # by name; "Default view" is the default
  section: ""                 # by caption; "" is the form's first section
  field: u_acc_rca_method
  after: cause_code           # optional: placed after this field; otherwise at the end of the section
  note: "the root cause method, which loads its template"
- kind: form_field
  table: sc_task
  view: sow
  section: Notes
  field: comments
  after: work_notes
  note: "workspace compose can post to the requester"
```

- `field` is a column of the table (the module's own, or a shipped one such as `comments`).
- `after` names an element already in the section. When it is missing on this instance, the field
  goes at the end of the section (the plan says so).
- Columns: a field placed after an element inside a split keeps that column. There is no explicit
  left or right column: `after` decides.
- No formatters, annotations or new sections in this kind. A new section would be a separate kind
  later (`form_section`), if a module needs one.

## 4. How it resolves and delivers

Following the `related_list` kind, step by step:

1. **Live read after the components step** (a plugin activation may replace a form, as KCS did for
   related lists). For each fact: the view by name, the section `name=<table>^view=<view>^caption=
   <section>^sys_domain=global` (first section when the caption is ""), and its elements through
   the keyset pager (ADR-0016).
2. **Status per fact**, in the plan under "Fields the modules add to forms":
   - **already there:** the field is on any section of that view (someone else put it there);
   - **ours:** our element is there (its derived sys_id);
   - **missing:** the module adds it;
   - **target absent:** no such view or section on this instance; skipped with the reason (a client
     renamed or removed the section).
3. **Generation:** one file per section, `source/<scope>/src/fluent/ensure-section-<sys_id>.now.ts`,
   generated and committed like the related-list containers:
   - the section restated by its keys (its real sys_id: F8);
   - **every element it has now, with its own sys_id and position**, then the modules' missing
     fields inserted after their `after` element (positions renumbered), each with a sys_id derived
     from pack, module, table, view, section and field;
   - in the scope that owns the section (`sys_ui_section.sys_scope`): global, or the workspace
     application's project.
   Several modules adding to one section share the file, as several modules share a related-list
   container today.
4. **Delivery:** through the SDK into the module's update set (validate, plan-push, push), so it
   promotes with the module. The section is taken over before the push like an adopted record,
   with one difference from adoption (decision D1 below): a section the client customized is **not**
   a stop, because the restatement is the section as it is now, the client's fields included.
5. **After the install:** the I10 after-install check covers this kind: each fact is read again from
   the pulled mirror; one that no longer holds is reported and the next plan adds it again.
6. **Removal:** a fact dropped from `ensure.yaml` removes only its own element (known by its derived
   sys_id and the ledger) at the next install, the section restated without it. Never another
   element.

**Promotion note:** an update set holding a whole section replaces the target instance's section
when committed. snagentic installs accelerators on each instance (ADR-0038 amendment: installs on
UAT and production), so each instance's section is resolved there and this does not arise. A client
who promotes the development update set by hand gets the development section; the install document
says so for every section it changes.

## 5. Spikes first (pdi2, about a day)

| Spike | Question | Pass |
|---|---|---|
| S-FF1 | Does the SDK build `Record(sys_ui_section)` with its `Record(sys_ui_element)` rows into the one section update the platform records (as `unit-specs.ts` models it), or is the SDK's `Form()` the only way? | one update `sys_ui_section_<id>` with every element; a re-push changes nothing |
| S-FF2 | Restating a shipped section whole with one element added: is it loaded (not refused as in F13), and are the existing elements kept with their sys_ids? | the form shows the new field; elements and order unchanged otherwise |
| S-FF3 | `sc_task`, view `sow`, Notes with Additional comments: does the workspace compose offer it? | compose shows Additional comments on a catalog task |
| S-FF4 | On domain-separated pdi2, which section does a user in the Default domain see when global and Default sections exist? | the rule for which domain's section to extend |
| S-FF5 | A section in a store application's scope (`sn_sow_req`) delivered from the module's child update set | loaded, as S-E for `sn_sow_inc` |

If S-FF1 fails (the SDK cannot express a section without the whole form), the fallback is the
SDK's `Form()` restated from the live form with every section, generated the same way, at the cost
of one generated form file per view instead of per section.

### 5.1 Spike results (pdi2, 2026-10-25)

Run with snagentic 2.10.0 plus I17, from a worktree of the ITSM pack's pdi2 workspace (branch
`spike/form-field`), through `take-over`, `plan-push` and `push`. Update sets "snagentic: spike
form-field" and its `[sn_sow_req]` child.

| Spike | Result |
|---|---|
| S-FF1 | **Passed.** `Record(sys_ui_section)` with one `Record(sys_ui_element)` per row builds into **one** unit, and the platform captures one "Form Layout" update `sys_ui_section_<id>` with every element inside. No `Form()` needed. A re-plan after the push: nothing to push. |
| S-FF2 | **Passed.** Problem task, Default view, "Analysis Information" (8 shipped elements) restated with `u_acc_rca_method` after `cause_code`: loaded, the 8 elements keep their sys_ids and order, the new one is at position 1, and the classic form shows "Root cause method" under Cause code. |
| S-FF3 | **Passed.** Catalog task, view `sow`, section "Catalog task" (17 elements; it has no Notes section) with `comments` after `work_notes`: the workspace compose's More menu offers "Additional comments (sent to the requester)", and a comment posted there is saved on the task (and request-portal copies it to the item, as built). |
| S-FF4 | **Partly.** The pull already reads sections of other domains: 3 of 7,130 sections on pdi2 are in the Default domain, none on the pack's forms. Not run: which section a user in the Default domain sees when both exist. That needs viewing as a Default-domain user (impersonation, refused here) or switching admin's domain (which other sessions' REST calls as admin would follow). |
| S-FF5 | **Passed.** The `sn_sow_req` section loaded from a project of that scope into the child update set `[sn_sow_req]`, as S-E did for `sn_sow_inc`. |

What the build must do, from the run:
- **Field rows leave `type` out.** The SDK types `sys_ui_element.type` and refuses `''`; split
  markers keep their type (`.split`, `.end_split`, `.begin_split`), and formatters keep `type:
  'formatter'` and their `sys_ui_formatter`.
- **The view by name** (`Default view`, `sow`); the SDK resolves it, and the live copy then
  compares equal.
- **Take-over first.** `plan-push` refuses an unadopted shipped section; `take-over` records it in
  the ledger. Decision D1 (restate a customized section) means the install's take-over must accept
  a customized section for this kind, which it refuses today.
- The two sections changed by the spike stay on pdi2. They are what the pack wants (the RCA
  method, the catalog task compose); the pack's `form_field` facts will own them from the first
  install with this kind.

## 6. Build, tests and order (about a week after the spikes)

| Step | Work | Tests |
|---|---|---|
| 1 | `domain/ensure.ts`: the `form_field` fact (parse, problems per entry, derived ids), section state, status, placement after an element across splits | unit and property tests: positions, splits, two modules on one section, `after` missing, own element kept in place |
| 2 | Generation: one section file per section, in the owning scope's project | golden files (`tests/fixtures`), including a split section and a workspace section |
| 3 | `ensure-layouts.ts`: live read of views, sections and elements through the keyset pager; take-over without the customization stop | contract tests on the fake instance reader |
| 4 | Install plan and document: "Fields the modules add to forms", per fact and per section (count of fields kept, field added, position), and the promotion note | golden plan text |
| 5 | After-install check for both kinds (I10's open item) | unit tests; live test |
| 6 | Removal of a dropped fact's own element | unit tests; live test |
| 7 | Live test on pdi2 (`tests/live`): a field on a Default view section, a field after another, a `sow` section in a store scope, a re-install that changes nothing, a removal | `SNAGENTIC_LIVE_INSTANCE=pdi2` |
| 8 | ITSM pack: the fields of section 1 as `form_field` facts; drop request-portal's interim "Message the requester" once S-FF3 passes; move incident-task's whole `Form()` to facts | the pack's T4 and T5 on pdi2 |

`bun run verify` at each step; the size and complexity limits apply (the domain file is already 188
lines: the kind goes in its own file, `ensure-form.ts`).

## 7. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| D1 | A section the client customized: stop for review (as adopted records do), or restate it as it is now with the field added? | Restate as it is now: nothing of the client's is lost, and stopping would block most real instances, whose forms are customized |
| D2 | Workspace forms in the first slice? | Yes: the catalog task compose gap is the main reason, and S-E already proved the scope route |
| D3 | Where the field goes when `after` is not on the instance | At the end of the section, said in the plan |
| D4 | Domains (S-FF4 partly run) | Extend the global section only, as related lists do; a domain's own section (the pull sees them) is reported, not changed. To settle what a domain user sees: allow a test as a Default-domain user, or go ahead without it (a domain's own section is reported either way) |
| D5 | Employee Center ticket fields (`ticket_configuration.info_fields`, today a whole restatement in request-portal) | A later kind, `list_value` ("this comma list contains this value"); not in this slice |
