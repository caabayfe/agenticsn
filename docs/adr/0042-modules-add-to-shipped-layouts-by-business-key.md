# 0042. Modules add to shipped layouts through ensure rules, found by table and view

- Status: Accepted (product owner, 2026-10-22). Not built yet: spec 011 I10
- Date: 2026-10-22
- Requirements: G1, ASR-01, ASR-15
- Amends: 0038 (item 8, taking over an out-of-box layout)
- Relates to: 0031 (Fluent authoring), 0033 (plans compare the build with the instance)
- Plan: `specs/011-accelerator-install/plan.md` (I10, finding F3; the KCS finding of 2026-10-22)

## Context

ADR-0038 item 8 lets a module change an out-of-box layout it does not own by restating the whole
record in its source and listing it in `adopt.yaml`. The install takes the record over only while
the client never changed it. The record is named by its sys_id.

Two things showed that the sys_id is the wrong handle for layouts:

1. **A plugin activation replaces layouts.** On 2026-10-22 the ITSM pack 0.5.0 install activated
   *KCS Integration for Incident Management* (`com.snc.incident.knowledge`) on pdi2. The plugin
   ships its own related-list container for the incident form (Default view). Loading it removed
   the platform's container (`5b6aff5b…`), and with it the two lists incident-relations had
   added, and created the plugin's (`454c3bdf…`). Nothing recorded the deletion: no audit row, no
   update set entry. The next install stopped, because the record it adopts was gone. On another
   instance the same activation would silently drop the lists, and a module written for one
   container id would fail on an instance where another plugin owns the layout.
2. **Many modules add to the same layout.** Related lists on the incident form come from
   incident-relations, incident-task and incident-knowledge. A whole-record restatement belongs to
   one module, so the others must edit that module's file (finding F3), and each plugin variant of
   a layout needs its own restatement.

What the modules want is never "this record, whole". It is a fact: "the incident form, Default
view, lists Incident Tasks".

## Decision

### 1. Ensure rules declare facts about configuration the module does not own

A module may add `modules/<m>/ensure.yaml`, a list of facts. Each fact names its target by
business key, never by sys_id. The first kinds are:

| Kind | Fact | Target found by |
|---|---|---|
| `related_list` | table T, view V lists related list R, after the lists already there | table, view, domain (`sys_ui_related_list`) |
| `form_field` | table T, view V, section S shows field F, after the fields already there | table, view, section caption |
| `inactive` | the record of table T with key K is inactive | the table's business key (for example `contract_sla.name`) |

Nothing else is free-form. A new kind is a small operation, tested on its own, added by a change
to this ADR's list.

### 2. The plan resolves each fact against the mirror

For each fact, the install plan reports one of:

- **already true:** nothing to do;
- **missing:** the module adds it;
- **target absent** (no such view or section on this instance): skipped, with the reason;
- **conflicting** (for example the list is present but a client hid it): blocks for review.

The plan resolves facts after the components step, because activations change layouts. The plan
records which container or section each fact resolved to, so the plan id changes when the instance
does.

### 3. Facts are delivered through the SDK, never around it

A resolved fact becomes Fluent in the module's build: a `sys_ui_related_list_entry` or
`sys_ui_element` record with the container's sys_id found by the plan, generated next to the
module's source. It goes through validate, plan-push and push like any other record, into the
module's update set, so it promotes with the module (ADR-0038 item 8: snagentic never writes
configuration around the SDK). The container itself is never restated, so the platform's and the
client's entries are left as they are.

### 4. After the install, the facts are checked again

The install's last step checks every fact against the pulled mirror. A fact that no longer holds
(a later plugin activation replaced the layout, as on pdi2) is reported, and the next plan adds it
again. `adopt.yaml` stays for records a module must restate whole (an SLA definition, a
notification body); layouts move to ensure rules.

## Consequences

- **Easier:** several modules add to one layout without sharing a file; a layout replaced by a
  plugin is found again by table and view; a client's own entries are never touched; the plan
  reads as facts an admin understands ("adds Incident Tasks to the incident form").
- **Harder:** snagentic gains a content kind, its resolution and its generated Fluent. Each kind
  needs care: an entry's position, a domain-separated layout, a section the client renamed.
- **To do:** spec 011 I10 builds `related_list` first (incident-relations, incident-task,
  incident-knowledge), then `form_field` and `inactive`; the ITSM pack moves its layout adoptions
  to `ensure.yaml` and drops the interim pin to the KCS plugin's container (pack 0.5.0).

## Alternatives considered

- **Keep adopting by sys_id, one restatement per plugin variant** (the 0.5.0 interim). Works
  where the variant is known, and needs a module to depend on a plugin only to know a container
  id. It breaks again with the next plugin that ships a layout.
- **Whole-layout `Form()` and `List()` from the SDK.** The SDK's way for a layout a module owns;
  for a shipped one it replaces the client's and the platform's entries, against ADR-0038 item 8.
- **Write the entries with the Table API at install time.** Simple, but outside the SDK and the
  update set the module promotes with.
