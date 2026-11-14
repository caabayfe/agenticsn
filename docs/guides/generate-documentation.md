# Generate documentation from the instance

snagentic builds a documentation site whose every claim is tied to a record in the mirror. When a
record changes, the page that cites it is flagged as stale, so documentation stops rotting
([ADR-0036](../adr/0036-verified-documentation-site.md)). **The agent writes the prose; snagentic
checks it, pins it and builds it.** snagentic never generates text itself.

```text
pull ─▶ census ─▶ write pages (agent, servicenow-document skill) ─▶ pin ─▶ check ─▶ build ─▶ serve
                                                                         ▲            │
            a change ─▶ docs impact: which sentences it makes stale ─────┴────────────┘
```

## Before you start

- A pulled, integrated mirror of the instance you document ([sync](sync.md)). A read-only
  production profile works: documenting never writes to an instance.
- The agent pack installed (`snagentic agent install`): it provides the `servicenow-document`
  skill, and `/mcp__snagentic__document` in Claude Code.
- Optional, for animations with sound and video: `ffmpeg` and Chrome (`--audio`, `--voice`,
  `--video`).

## 1. Ask for a process

Ask the agent in plain words:

> *Document incident management for the people who use it.*

The skill starts from the readers, not the code. It `describe`s the table for its states and
fields, `find`s the records behind each one, and writes the sources under `documentation/` in the
workspace, in git:

```text
documentation/
  site.yaml                       title, the instance, the portals and workspaces readers use
  questions.yaml                  open questions shared by every process
  processes/incident/
    process.yaml                  roles, lifecycle, capabilities, tables
    features.yaml                 every feature found, each with a decision
    questions.yaml                what the mirror can't tell
    understand/ use/ operate/ configure/
  animations/<name>/              animation.json, scene.svg, steps.json
```

The four sections are for three readers: **understand** (shared), **use** (employees, on the portal),
**operate** (service desk and resolvers, on the workspace or form) and **configure** (the platform
team: the records behind each capability).

A minimal `process.yaml`:

```yaml
title: Incident management
summary: >-
  When something you use for work stops working, report it as an incident. The service desk sorts
  it and the right team fixes it.
order: 1
tables: [incident, task_sla, incident_task]   # what `docs census` searches
roles:
  - { id: caller, name: Caller, audience: user, description: anyone who reports a problem }
  - { id: agent, name: Service desk agent, audience: operator }
lifecycle:
  - { state: New, meaning: logged, nobody working on it yet }
  - { state: In Progress, meaning: someone is working on it }
capabilities:
  - { id: report, title: Report an incident, summary: Tell IT what is wrong., roles: [caller] }
  - { id: assign, title: Assign an incident, summary: Route it to the right team., roles: [agent] }
```

## 2. Find every feature

```sh
snagentic docs census incident
```

It lists every application that reaches the process's tables, from the mirror: form and workspace
actions, business rules, client scripts, UI policies, notifications, SLAs, and tables that refer to the
process. Each must be named in `features.yaml` with a decision ([ADR-0040](../adr/0040-every-feature-of-a-process-has-a-decision.md)):

```yaml
features:
  - id: core
    title: Incident handling (log, prioritise, assign, work, resolve, close)
    found: [global, sn_sow_inc:Assign to me, sn_sow_inc:Resolve]
    status: documented               # or todo, out-of-scope, question
    capabilities: [report, assign]
```

Anything the census finds that no feature names is reported as **undecided**. What only a screen shows
(workspace buttons, side panels) is found by walking the form as each role and recorded as `seen`.

## 3. Write a page with its evidence

Every claim cites an evidence item; the item names the record, what was read, and the record's hash
when it was verified. `operate/assign.md`:

```markdown
---
title: Assign an incident
evidence:
  E01:
    record: sys_script/27453ac6b73610102d2fbc16de11a937
    how: read Populate Assignment Group based on CI/SO
    result: with no group and no assignee, a configuration item fills the group with its support group
  E02:
    record: sys_ui_action/3b991ad673da20103e366238edf6a7f3
    how: read Assign to me (list menu)
    result: for agents who are members of the incident's group
---

Open **Unassigned** and choose **Assign to me**. [E02]

If the incident has a configuration item, its support group is filled in for you. [E01]

{{animation:assign}}
```

Rules the checker enforces:

- A claim cites evidence as `[E01]`; a citation of an unknown item is an error.
- Link other pages as `[text](see:incident/follow)`; a dead link is an error.
- What the mirror can't prove (an on-screen label, portal content) is `seen` evidence: who looked,
  when, and where. Never write `seen` for a screen nobody opened.
- What you can't establish is a **question**, never a paragraph of guesses. Record it once in
  `questions.yaml` (`snagentic docs questions --search ...` first, to avoid duplicates):

  ```yaml
  questions:
    - id: Q04
      ask: Should AI Search be switched on so Recommendations work, or hidden?
      kind: decide          # decide (the owner chooses), check (a screen nobody opened), hidden (redacted)
      who: owner
  ```
- End-user pages avoid platform words (`vocabulary` in `site.yaml`); `check` warns.

## 4. Animations

Pages for `use/` and `operate/` show the capability as a narrated animation. Each is three files in
`documentation/animations/<name>/`:

- `animation.json`: `name`, `title`, `heading`, `tags` (what it was observed from), `vb` (the
  view box, `[960, 440]`), `foot`;
- `scene.svg`: the picture;
- `steps.json`: one entry per step, each with `t` (the step's name), `c` (the caption shown) and `say`
  (the narration), and optionally `cam` (zoom and pan: `[scale, x, y]`).

```json
[
  { "t": "Open",   "c": "Open <b>Unassigned</b>.", "say": "Open the Unassigned list." },
  { "t": "Assign", "c": "Choose <b>Assign to me</b>.", "say": "Choose Assign to me.", "cam": [1.45, 258, 193] }
]
```

Embed it with `{{animation:assign}}`. `check` fails a page that names an animation that doesn't exist.

## 5. Pin, check, build, preview

```sh
snagentic docs pin                  # records the mirror's current hash in each page's evidence
snagentic docs check                # exits 1 when a page is no longer true or a source has an error
snagentic docs build                # a static site in .snagentic/site/
snagentic docs serve                # http://127.0.0.1:4173/ for a preview
```

Run `pin` **only after you re-read the records the claims rely on**. It is what says "this was
verified", so never pin to make `check` pass. `check` also warns about open questions that may be
moot and possible duplicates.

Media, all optional:

```sh
snagentic docs build --audio            # music and effects (needs ffmpeg)
snagentic docs build --voice piper      # also narrates the steps (piper or system)
snagentic docs build --video            # an MP4 on every animation (needs ffmpeg and Chrome)
snagentic docs video assign             # one animation as .snagentic/videos/assign.mp4
```

Publishing is copying `.snagentic/site/` to any web server; snagentic doesn't publish for you.

## 6. Keep it true as the instance changes

Every change to an instance record or to Fluent source can make a sentence stale. On a pull
request:

```sh
snagentic docs impact --base origin/main --format json
```

It lists each claim (sentence, list item or table row) whose evidence the change affects, with
its page, heading and reader. Re-read each record, fix the claims in the same change, then `pin`
and `check`. `validate` reports SN-MNT-014 and SN-MNT-015 when a change makes documentation stale. A
change that alters what employees or IT do also gets a note in
`documentation/changes/<release>.md`, and `validate` reports SN-MNT-017 when one is missing.

## 7. Employee guide

Employees enter by what they want to do, not by process. `site.yaml` lists the tasks and the pages
behind each ([ADR-0037](../adr/0037-an-employee-guide-and-an-it-guide-from-one-source.md)):

```yaml
employees:
  title: Employee guide
  start: [getting-help/channels]
  tasks:
    - title: Something isn't working
      icon: alert
      summary: Report it, follow it, and confirm the fix.
      pages: [incident/report, incident/follow, incident/confirm]
```

## Reference

All the commands are in the [command reference](../reference/commands.md#docs-census): `docs census`,
`docs check`, `docs questions`, `docs impact`, `docs pin`, `docs build`, `docs serve`, `docs video`.
Design: ADR-0036, ADR-0037, ADR-0039, ADR-0040, ADR-0041.
