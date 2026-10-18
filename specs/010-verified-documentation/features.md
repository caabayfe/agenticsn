# 010f. Every feature of a process is found and decided (ADR-0040)

- Status: pilot built on incident (2026-10-18), ADR-0040 proposed

## 1. Why

On pdi2 the incident pages never mentioned Discuss, Playbook, Agent Assist or Create Knowledge,
and mentioned communication plans only for major incidents. The configuration index listed 369
incident records no page cited, with no way to tell features apart. Features reach a process
from the side: their own tables refer to it, their own application adds buttons to it.

## 2. The census

`snagentic docs census <process>` reads the mirror for each process table and the tables it
extends (from `sys_db_object.super_class`):

| Signal | Field | Parent tables (task) |
|---|---|---|
| UI actions (`sys_ui_action`) | `table` | yes |
| Workspace actions (`sys_declarative_action_assignment`) | `table` | yes |
| Business rules, client scripts, UI policies | `collection` / `table` | no |
| Notifications, SLA definitions | `collection` | no |
| Tables that refer to it (`sys_dictionary.reference`) | `reference` | only from applications other than global |

Inactive records are left out. Records are grouped by the scope folder that holds them, titled by
the application's shortest menu title (`sys_app_application`), the platform's own (global) first.
The mirror adapter matches the field's line in the raw YAML before parsing, so the 143,000
dictionary entries on pdi2 take about 30 s in all.

## 3. features.yaml

```yaml
features:
  - id: communication-plans
    title: Communication plans
    found: [sn_comm_management, "sn_sow_inc:Open new communication modal"]
    seen: { by: …, on: 2026-10-18, where: … › More actions › Create new communication }
    status: documented            # todo | out-of-scope | question
    capabilities: [communicate, major-incident/communicate]
    note: …                       # required for out-of-scope (why, who) and question (what to ask)
```

- `found` claims a whole application by scope, or one item by `<scope>:<name>` (the name the
  census prints), so an application holding several features is split.
- `seen` declares what only the screen shows (the workspace header's Sidebar discussions).
- `docs check`: `undecided-feature` (warning) for what the census finds and no feature claims,
  run only for processes with a features.yaml; `undocumented-feature` (error) for a documented
  feature without capabilities or naming one that doesn't exist.
- The site: a Features table on the process's IT page (status, pages, or why not) and "N of M
  features documented" on its card. Out-of-scope features don't count in M.

## 4. The screen walk

The census can't see what UI Builder pages compose. On pdi2's incident in the workspace, the walk
found, beyond the census:

- header: Sidebar discussions (All, Unread, This record, Mentions; New discussion);
- side panel: Record Information, Recommendations, Agent Assist, Collaborate (chat),
  Attachments, Response Templates, Templates, Email template;
- More actions: Compose Email, Copy Incident, Report Knowledge Gap, Copy URL, Delete, Create new
  communication;
- Related records: Task SLAs, Affected CIs, Impacted Services/CIs, Child Incidents, Attached
  Knowledge, Alerts, Incident Communication Plans, Affected Locations.

The skill makes the walk a step of every process (as each role).

## 5. Incident on pdi2

16 applications, 18 features: 4 documented (core handling; communication plans and Discuss,
written in the pilot, with Collaborate chat found to be the same Sidebar discussions), 7 to do,
4 questions, 3 out of scope (major incident is its own process, CAB meetings belong to change,
test SLA definitions). The card reads "4 of 15 features documented".
