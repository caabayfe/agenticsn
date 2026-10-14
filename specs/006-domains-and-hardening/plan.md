# 006. Domain separation and the 1.5.0 stress-test findings

- Status: Proposed
- Date: 2026-10-13
- Source: the User Access Review build on pdi2 (1.5.0), and a survey of domain handling in the code
- Requirements: ASR-01, ASR-02, ASR-05, ASR-16

## Why

Building a two-week scoped application on pdi2 through the workspace flow worked, but only
with hand repairs. Most of them came from one capability snagentic does not have yet: domain
separation. pdi2 is domain-separated: records an agent created came back from the instance
in the TOP/Default domain, under `domains/<sys_id>/`, and integrate kept both copies. Managed
service providers run ServiceNow domain-separated, one domain per customer, and the ITSM
accelerator (spec 005) targets them. Domains are therefore the first priority.

## Phase A: domain separation (1.6.0)

### What the code does today

| Area | Today | Gap |
|---|---|---|
| Disk layout | `domains/<domain sys_id>/<scope>/<class>/…` for any domain other than `global` (`record-layout.ts:44-49`) | Domains appear as opaque sys_ids; nothing maps them to names |
| Identity | `relocatedRecords` and `pulledCopy` match on a folder that includes the domain (`record-layout.ts:78-83`, `plan-push.ts:90-102`) | A record pushed without a domain and pulled back in one is never paired: integrate keeps two files, the next plan creates it again and push fails |
| Create | `sys_domain` is in `_meta` and never sent (`change.ts:153`, `push-steps.ts:206-210`) | The instance chooses the domain; the agent cannot |
| Update | Only class and sys_id are compared (`change.ts:62`) | A change of `_meta.sys_domain` is dropped silently |
| Detection | Nothing reads `com.glide.domain` | snagentic cannot tell an agent the instance is domain-separated |
| Knowledge | `sys_overrides` and per-domain copies are not modelled | `describe` hides that a business rule runs differently per domain |
| Tests | Only layout and hash tests mention domains | Plan, push and integrate are untested with domains |

### Decisions to take (ADR-0027, after spike S12)

1. **A domain is an attribute of a record, not part of its identity.** Identity stays scope,
   class and sys_id, as verify already treats it (`verify-buckets.ts:22`). Relocation, plan and
   integrate pair records across domain folders.
2. **Domains are named.** Pull already lists the `domain` table into the operational
   inventory; status, plan and describe show domain names, and the agent writes a domain by
   name or sys_id.
3. **A create says its domain.** On a domain-separated instance, a new record in a
   domain-aware table must carry `_meta.sys_domain`; plan refuses a create without it and names
   the instance's domains. A workspace can set a default domain per instance (`instance.yaml`),
   so a team working for one customer does not repeat it.
4. **Push writes the record in its domain**, as it now writes it in its application: either by
   sending `sys_domain`, or by switching the session's domain like `apps.current_app`. Spike
   S12 decides which the platform honours.
5. **Moving a record to another domain is refused** for now, with the instance's own procedure
   as the hint. Moving between domains changes who sees a record; it deserves its own decision.
6. **Domain overrides are visible.** `describe` lists a record's per-domain copies
   (`sys_overrides`), and `validate` checks the copy an agent edits, not only the parent.

### Spike S12 (before ADR-0027), on pdi2

- Which tables are domain-aware (`sys_domain` field), and how many records sit outside global.
- Table API insert: is `sys_domain` honoured, ignored, or taken from the session? Is there a
  domain preference, as `apps.current_app` is for the application?
- Update sets: does a domain-specific record travel in an update set and land in the same
  domain on the target?
- Overrides: what a `sys_overrides` copy looks like in the mirror, and what pull does with it.

### Work items

| # | Item | Size |
|---|---|---|
| A1 | Spike S12 and ADR-0027 | 1 day |
| A2 | Identity across domain folders: `relocatedRecords`, `pulledCopy`, integrate (`takeRelocated`), with fixtures | 1 day |
| A3 | Detect domain separation (`com.glide.domain`), name domains from the inventory, show both in `status` and plan output | 0.5 day |
| A4 | Creates carry a domain: plan check, `instance.yaml` default, push writes it (per S12) | 1.5 days |
| A5 | Refuse domain moves on update, with a hint | 0.5 day |
| A6 | `describe` and `validate` aware of overrides | 1.5 days |
| A7 | Agent guidance: which domain to build in (TOP for shared logic, a customer's domain for its customizations) | 0.5 day |
| A8 | Live contract test on pdi2 (`tests/live`): create, pull back, integrate, edit, push in a domain | 0.5 day |

Fix the identity first (A2): it stops the duplicate files today, whatever ADR-0027 decides.

## Phase B: hardening found during the build (1.5.1)

| # | Finding | Fix |
|---|---|---|
| B1 | The pre-commit hook validates untracked files, which are not part of the commit; an integrate merge failed on files nobody was committing | The hook checks what is being committed (the index against HEAD), not the working tree |
| B2 | Integrate reports a pre-commit refusal as "a bug in snagentic" | Report "the pre-commit check blocked the merge commit", with the findings and the next step |
| B3 | Dropping a table removed its dictionary entries without a change the incremental pull saw; the mirror kept them until `pull --verify` | When the record feed shows a `sys_db_object` deleted, remove that table's dictionary entries, choices and layouts from the mirror |
| B4 | Rows created before their owner (choices pushed before their table existed) were never pulled | When an incremental pull writes a new owner record, read its child rows |
| B5 | Writes that land outside the batch (145 updates in the app's Default update set) can only be fixed by hand | Push reports where an uncaptured write landed; a new write use case moves this push's own updates into the batch, only for updates this user made, never others' (needs an ADR: it writes update sets) |
| B6 | The elevated browser session's sign-out seemed to end the user's own browser session | Investigate on pdi2; if confirmed, close the elevated session without signing the user out elsewhere (ADR-0024 amendment) |
| B7 | Every new build prompts the macOS keychain again | Sign development builds with one stable identity, or document `security set-generic-password-partition-list` for maintainers |
| B9 | List layouts (`sys_ui_list`) and related lists written through the Table API get no update set entry at all, even on create; form sections are recorded as their form (`sys_ui_form_sections_<form>`) | Capture of sections fixed (looked up through the form). Lists: spike S13 on how the platform records list layouts (the UI's "Configure list layout" writes a "List Layout" update); until then push reports them as not captured with that reason |
| B8 | A scoped app's background scripts failed without a log line until runtime access tracking granted its cross-scope privileges interactively | Pull mirrors `sys_scope_privilege`; `advise` and the build skill ask for declared privileges; a rule warns when a scoped script reaches a global table without one |

B1 and B2 are small and go first; B8 is what made the app's launch fail silently.

## Phase C: agent guidance (with A7 and B8)

Revise the workspace AGENTS.md and skills with what the build taught:

- Domains: check whether the instance is domain-separated, and say which domain a record
  belongs to.
- Scoped applications: declare cross-scope privileges; platform tables such as
  `sys_user_has_role` cannot be written from a scope, so use a narrow global helper that checks
  its caller.
- A refused or failed operation must never be recorded as success (the revoker reported a
  refused delete as "already removed").
- Update sets: never move or delete them by hand; push owns the batch.
- Deliver large features in phases (data model first, pull, then logic), as this build did.

## Phase D: the Access Review application (pdi2)

| # | Item |
|---|---|
| D1 | Declare the app's cross-scope privileges as files; launch a second campaign to confirm the script action runs |
| D2 | Bulk "Keep access" returns to the list instead of opening the last item |
| D3 | Acceptance scenarios 4 (another reviewer) and 5 (auditor) |
| D4 | Move the 145 updates into the batch (with B5, or by hand once) |
| D5 | Notifications and the daily job, tested with a short reminder interval |

## Progress (2026-10-14)

- Done: B1, B2, A2 (1.5.1, PR #49); ADR-0027 with spike S12 (A1, A3, A4, A5), B4, B5, C, B7
  notes, the global update set restore and section capture, and B8's rule SN-MNT-008 (branch
  feat/domains). On the Access Review scripts the rule finds one undeclared table,
  `sys_user_grmember`, read by the generator.
- On pdi2: the application's records moved to global (ADR-0027); its cross-scope privileges are
  mirrored as files, and a second campaign generated its items unaided (D1); Keep returns to the
  list (D2).
- Deferred: B3 (deletions on table drop: `pull --verify` reconciles meanwhile), A6 (overrides),
  B6 (elevated sign-out), B9's spike, D3 (scenarios 4 and 5), D4 (the misplaced
  updates from before 1.5.0), D5.

## Order

1. B1, B2 (1.5.1).
2. A2, then S12 and ADR-0027.
3. A3 to A8 and B3, B4 (1.6.0).
4. B5 to B8, then C and D.
