# 010a. Three audiences: users, operators, platform team

- Status: Accepted (product owner, 2026-10-17); A1–A4 done (2026-10-17)
- Amends: ADR-0036 decision 2 (page layout), spec 010 §2 (sources) and §3 (site)
- Requirements: G2, ASR-01, ASR-13
- Origin: product owner review of the pdi2 incident documentation (2026-10-17). End users,
  operators and the platform team are different readers. End users and operators share the
  understanding of the process, but not the steps.

## 1. The problem with today's model

Every capability has a **guide** and a **technical** page, and a guide serves every role the
capability lists. On pdi2 this mixed readers:

- `resolve` serves the resolver (form, resolution code) *and* the caller (confirm or reopen);
- `close` serves the caller, the resolver and the team lead;
- the caller's pages say "Employee Center" without anchored evidence of what the portal shows,
  because the research looked at the platform first and not at the portal.

## 2. The model

A process has **four sections**. Each one has a reader, a surface that reader works on, and the
evidence that proves what that surface shows.

| Section | Reader | Surface (configured per site) | Evidence from the mirror |
|---|---|---|---|
| **Understand** (shared) | users and operators | none: how the process works | lifecycle choices (`sys_choice`), SLA definitions, notifications, priority lookup |
| **Use** | end users (callers, requesters) | Employee Center, Virtual Agent, email, phone | `sp_portal`, `sp_page`, `sp_instance`, `sp_rectangle_menu_item`, `topic`, `sc_cat_item_producer` and its questions (`item_option_new`), `sys_cs_topic`, `sysevent_in_email_action`, `sysevent_email_action` |
| **Operate** | operators (agents, resolvers, leads, major incident managers) | Service Operations Workspace and/or the classic form | `sys_ux_list`, `sys_declarative_action_assignment`, `sys_ui_section` + its `sys_ui_element` children (form layout), `sys_ui_action`, `sys_ui_policy`, `sys_dictionary`, `sys_choice` |
| **Configure** | platform team (admins, developers, process owner) | the configuration | anything; business rules, ACLs, client scripts, flows, script includes, SLAs, with the script fields |

Checked on pdi2 before planning: the mirror holds all of these (12 portals including Employee
Center, 25 record producers, 652 questions, 86 Virtual Agent topics, 673 declarative actions,
95 workspace lists, 14,167 form sections with their fields, choice sets as children). The earlier
open question about Employee Center labels can be answered from the mirror.

### Understand: one source, two views

The shared pages are written once and shown in both the Use and the Operate section, each time
in that reader's view. A heading can be limited to one reader, with the same syntax as labels:

```markdown
## What the states mean
…shared text…

### What you see in Employee Center {for=user}
"Open", "Awaiting your response", "Resolved" …

### What you see in the workspace {for=operator}
New, In Progress, On Hold (and its reasons) …
```

A limited heading covers its content up to the next heading of the same or higher level.
Standard shared topics: `overview`, `lifecycle`, `priority-and-deadlines`, `who-is-told`,
`glossary`. A process may add more.

Why two views instead of one shared page: a portal user should never read about work notes or
assignment groups, and an operator needs the internal state names. Writing the shared text once
keeps both views consistent; filtering keeps each one readable.

### Capabilities belong to one audience

A capability is something one reader does, on one surface. Its roles must all be in one
audience, and `docs check` reports a capability that mixes them. Work that both sides take part
in is split into two capabilities linked as counterparts:

```yaml
roles:
  - { id: caller, name: Caller, audience: user }
  - { id: resolver, name: Resolver, audience: operator }
capabilities:
  - { id: resolve, title: Resolve an incident, roles: [resolver], counterpart: confirm }
  - { id: confirm, title: Confirm or reopen the fix, roles: [caller], counterpart: resolve }
```

Each Use and Operate page links to its counterpart ("what the service desk does now", "what the
caller sees"). Each Operate capability has a Configure page; a Use capability may share its
counterpart's Configure page (`configure: resolve`) or have its own (the portal channel, for
example).

### Sources

```
documentation/
  site.yaml                      + surfaces: { user: [employee-center, virtual-agent, email, phone],
                                               operator: [workspace, classic] }
  processes/incident/
    process.yaml                 + roles[].audience, capabilities[].counterpart, .configure,
                                   understand: [overview, lifecycle, …]
    understand/<topic>.md        shared, with {for=user|operator} headings
    use/<capability>.md          end user guide
    operate/<capability>.md      operator guide
    configure/<capability>.md    technical page (evidence required)
```

`site.yaml` `surfaces` names what each audience works on, so the method and the checks know
whether operators use the workspace, the classic form or both. A surface can name the record
behind it (`employee-center: sp_portal/70cd9f3b734b13001fdae9c54cf6a72f`).

### The site

```
index.html                         processes
processes/incident/index.html      the summary, the lifecycle, and three doors: for end users
                                   (with their surfaces), for operators, for the platform team
processes/incident/use/…           Understand (user view, in use/understand/) + Use capabilities
processes/incident/operate/…       Understand (operator view, in operate/understand/) + Operate
                                   capabilities, in order
processes/incident/configure/…     Configure pages + the configuration index
```

Each section has its own navigation and never links into another section's steps, except
through counterpart links and "how this is configured" links (Use and Operate to Configure).
Animations can be embedded anywhere; their transcripts follow the page's audience.

### Configure: a generated configuration index

Built from the evidence, not written by hand. It lists every cited record, grouped by type
(business rules, ACLs, client scripts, UI policies, UI actions and declarative actions,
notifications, SLAs, flows, script includes, others), with:

- the record's name, table and when it runs (`when`, `order`, `condition`, read from the mirror);
- the pages that cite it;
- whether its evidence is fresh.

With `process.yaml` `tables: [incident, task_sla, …]`, the index also lists the **active
records on those tables that no page cites**, by type. This brings P4's coverage forward for one
process, read only, from the mirror. Telling customisations from baseline records needs the
inventory of customised out-of-box records that rule SN-UPG-002 also waits for; until it
exists, the list shows every uncited record, with its last updater and update date.

## 3. What `docs check` adds (enforced in code)

| Check | Severity |
|---|---|
| A capability whose roles span audiences | error |
| A counterpart that doesn't exist or doesn't point back | error |
| A `{for=…}` heading on a page outside `understand/` | error |
| An Operate page without a Configure page (own or shared) | error |
| A Configure page without evidence (as today) | warning |
| A Use or Operate page that cites no evidence from its audience's surface tables (the steps weren't checked on the reader's screen) | warning |
| Platform words in Use pages: table or field names (`incident.state`, `sys_id`, `snake_case` words), state codes (`state=3`), and a per-site list (`work notes`, `assignment group`, …) | warning |
| A role with no capability | warning |

The vocabulary check is a heuristic, so it warns and never blocks. The surface-evidence check
warns because some steps (a phone call) have no record.

## 4. The method (skill `servicenow-document`)

The skill gets one pass per audience, each starting where its reader starts:

1. **Understand.** States and their portal labels, priority and deadlines, who is told what.
   Write each shared topic once; mark only what really differs.
2. **Use.** Start at the portal: the Employee Center menus and topics → which record producer
   the user picks → its questions → the ticket page and what the user can do there → the emails
   they get → Virtual Agent and email channels. Use the portal's words. No platform words.
3. **Operate.** Start at the workspace list the operator opens → the form (sections and fields
   from the layout) → the actions they can take → what each action requires and does → what
   others are told. Classic-form differences only when the site lists both surfaces.
4. **Configure.** For each Operate capability: the records behind it, with scripts read for
   what they do, and the open questions the mirror can't answer.

## 5. Incident on pdi2, remapped

| Section | Pages |
|---|---|
| Understand | overview, lifecycle, priority and deadlines, who is told what, glossary |
| Use | get help (choosing between the record producers or Virtual Agent), follow your request, answer a question from the service desk, confirm or reopen the fix, rate the service (survey) |
| Operate | log and categorise, set the priority, assign, work on an incident, resolve, close, reopen or cancel, escalate and link work, run the queue (team lead: unassigned, breaching), lead a major incident |
| Configure | one per Operate capability, the portal and email channels (for Use), the configuration index |

The 140 existing evidence items carry over. The Use section needs new research from the portal
records. Open questions 7 (form labels) and 8 (Employee Center labels) are answered by the
form layout, `sys_choice` and `sp_*` records.

## 6. Phases

| Phase | Delivers | Exit test |
|---|---|---|
| **A1 Model** | `process.yaml` audience, counterpart, configure, understand, tables; `site.yaml` surfaces; new page paths; `{for=…}` filtering; four-door site with its navigation; the `docs check` rules above; anchors on child records (`children: sys_ui_element`) | A fixture workspace with all four sections builds; each rule has a failing and a passing case; a user view never contains a `{for=operator}` section |
| **A2 Incident** | The pdi2 incident documentation rewritten to the model, with portal and workspace research | `docs check` clean; Use pages cite portal records; no vocabulary warnings in Use |
| **A3 Index** | Generated configuration index and uncited customisations | Every cited record appears once with its citing pages; an uncited active record on a listed table appears |
| **A4 Skill** | The four-pass method in `servicenow-document`, within the 60-line skill limit | Skill contract test; rerun of the incident documentation from the skill alone |

Then P4 (the gate in `validate`) as planned, on the new model.

There is no compatibility layer for the old `guide`/`technical` paths: nothing has shipped them
yet (PR #67 isn't merged), and the only workspace using them is `spaces/pdi2-docs`, which A2
migrates.

## 7. Decisions (product owner, 2026-10-17)

1. **Understand is one source with two views.** The user view and the operator view are built
   from the same page; `{for=…}` headings differ.
2. **Operators on pdi2 use both surfaces**: the Service Operations Workspace and the classic
   form. Operate pages describe the workspace and note where the classic form differs.
3. **Screen checks are allowed** as `seen` evidence: who checked, on which date, and where (a
   portal page, a phone script). `docs check` reports them as unanchored and asks to recheck them
   after 90 days; they never count as fresh mirror evidence.
4. **No screenshots** in this plan.

### Seen evidence

```yaml
evidence:
  E07:
    seen: { by: Fernando Caamaño, on: 2026-10-17, where: Employee Center › Get help }
    how: opened the portal menu
    result: the menu item reads "Get help"
```

| Status | When |
|---|---|
| `seen` | checked within the last 90 days |
| `recheck` | older than 90 days: a warning naming the page, never a blocking error |

## 8. Links between pages (010b, 2026-10-17)

Processes refer to each other: incident escalates to major incident and problem, request to
change. A page links another with `[text](see:<target>)`:

| Target | Leads to |
|---|---|
| `see:<topic>` | the topic in the same process |
| `see:<process>/<topic>` | the topic in another process |
| `see:<process>/<section>/<topic>` | that section's page |
| `see:<process>` | the process's page |

Without a section, the reader's own section wins: an end user's link goes to the end user's page
when the topic has one, then the shared page (in the reader's view), then the others. `docs
check` reports a link that leads nowhere as `unknown-reference`, an error.

## 9. Every capability is shown (010c, 2026-10-17)

Product owner: people learn a process by seeing it, so animations are part of every guide, not an
extra.

| Rule | Where | Severity |
|---|---|---|
| A Use or Operate page embeds at least one `{{animation:…}}` | `docs check` (`missing-animation`) | error |
| Every animation step has its spoken line (`say`) | loading the scene | error |
| A guide without an animation | `validate` (SN-MNT-016) | warning: never holds a push |

`docs build --video` renders every animation as an MP4 into the site, with a *Download the video*
link under its player, and names each animation it could not render (no browser, no ffmpeg);
nothing is skipped silently. Shared pages that explain a flow get one too, by the method.

