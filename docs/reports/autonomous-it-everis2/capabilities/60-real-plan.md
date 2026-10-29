# The real plan: from tested capabilities to an autonomous IT demo

**Date:** 28 October 2026. **Status updated:** 29 October 2026 evening, after two days of quality fixes and the 5-run gate
([70-quality-plan.md](70-quality-plan.md)). **Phase 2 added:** 29 October (W1 to W7).

**Basis:**
- 77 of 93 capabilities tested live on everis2, with 82 screenshots, 2 transcripts and the AI logs;
- results are in [50-test-plan.md](50-test-plan.md), the raw log in the
  [evidence README](../evidence/capabilities-2026-10-28/README.md).

This plan replaces assumptions in the [roadmap](../06-roadmap.md) and the
[implementation plan](../07-implementation-plan.md) with what the instance actually does.

## What the tests prove

| # | Lesson | Evidence |
|---|---|---|
| L1 | **The skills work. The Otto panel's routing is the weak link.** Every skill reached from a record (summarize card, alert insight, wrap-up, SLA, recommendation) worked. Free-text requests in the panel failed in 7 of 7 generate, recommend, create and set-up cases: the LEAP agent took them and asked for an automation opportunity number. LEAP itself shows "Settings are not configured!". Record numbers were not looked up: KB0000008 was described as the wrong article. A plain list question ended in "problem on my side". The suggested skill "Analyze related incidents" looped 59 times. A survey question got "I don't understand". The counter-case: on an alert record, "create an alert automation" reached its own agent and returned a proposal, so record context decides the route. | SD07, SD10, SD15, SD28, KA02, KA07, KA18, KA22, OP06, OP11, OP18 (13, 28, 50, 54, 55, 70, 71, 73, 74, 81, 83) |
| L2 | **Admin is not a persona, and access fails silently.** Some agents ran for the admin test user, others were refused with "You don't have the required access". In two cases the real cause was an inactive workflow or an ACL. 8 agents have no ACL roles. The daily "Generate my work plan" trigger runs as `system` and was blocked 78 times, so the "80 runs" in usage were never real use. | OP12, std change, SD11, PG02, PG12 (18, 49, 59-61) |
| L3 | **Weak data makes agents look wrong.** The alert didn't bind to a CI (`SAP WEB01` exists but isn't a host). Change CI suggestion found nothing. The KB comes from a US university (VPN shared secret, "8-HELP"). Incident numbers are duplicated, and some records are On Hold but inactive. Clustering is empty. All 9 AI Agent Advisor runs failed: only 35 of the 500 closed incidents it needs have a usable issue and root cause. That cost 359 LLM calls for no output. The Insights dashboards show no data because their indicators are not collected. | OP01, CI suggestion, KA06, KA08, KA14, PG15, SD32 (08, 20, 33, 52, 66, 72) |
| L4 | **Hand-offs between AI steps break.** Chat to incident: forms open empty. Alert to incident: a plain copy without the AI insight. Wrap-up to KB: "Unable to create knowledge article". The Approve button in the panel starts a new plan. | SD21, OP04, SD05 (31, 35, 42-44, 48) |
| L5 | **Governance exists but is not switched on.** AI Control Tower manages 0 of 334 AI systems and none of the 3 MCP servers, including the iCenter "Test MCP" with 21 tools. The guardian runs on every call (+426 ms) but has flagged 0 injections since July; its OOB dashboard is the place to show the block. The AI Value Dashboard widgets show "Error". The AI Agent Analytics dashboard (OOB) already shows blocked runs, errors and an inferred CSAT of 3.5. | PG07, PG09, PG12, PG13 (17, 56-58, 60-63, 65, 68) |
| L6 | **Autonomy already works in operations.** An event became an alert, the autonomous agent completed 2 plans with no human, and the AI note arrived in 2 minutes. The on-demand insight even reused this morning's AI resolution. | OP01, OP03 (45-47) |

```mermaid
flowchart LR
  subgraph Works["Works today"]
    R["Record-bound skills<br/>summaries, SLA, plan,<br/>wrap-up, alert insight"]
    E["Employee Otto chat<br/>Q&A, catalog, status"]
    O["Autonomous alert agent"]
  end
  subgraph Breaks["Breaks today"]
    P["Panel routing<br/>(LEAP hijack, no lookup)"]
    A["Access<br/>(admin, system, no ACL)"]
    D["Data<br/>(CIs, KB, duplicates)"]
    H["Hand-offs<br/>(chat, alert, KB)"]
    G["Governance off"]
  end
  Breaks -->|"Sprint 0: make it real"| Works
```

## Status on 29 October

Two days of quality work on the 13 demo steps ran under the owner's approval for data, configuration
and activations. Each step was measured against an answer key, fixed, and retested. The method and
the scores are in [70-quality-plan.md](70-quality-plan.md). The evidence and revert steps are in
[evidence/quality-2026-10-28](../evidence/quality-2026-10-28/). The demo runs from
[08-demo-script.md](../08-demo-script.md).

**Average: 6.0 to about 9.2 of 12** (12 rescored steps, Q09 per ticket). Top quality is 10 or more, in 5 of 5 runs, in both languages.
No step has passed the full gate yet: every score below comes from one or two runs.

| Step | Before | Now | What changed | What's left |
|---|---|---|---|---|
| Q01 SLA | 3 | **11** | Global copy "Explain SLA (AIT)", 8 SLA definitions linked to the breakdown, Spanish persona | No silence data; a breached sibling SLA isn't mentioned |
| Q02 On call | 7 | **9** | SAP rota, 3 fictitious SAP users, persona role `oc_read` | No shift end; can't assign or page |
| Q03 Recommend | 7 | not rescored | Runs automatically on assignment, in Spanish, as the persona | Doesn't cite similar incidents; routing to Network |
| Q04 Wrap up | 8 | **9** | Spanish persona, the persona in the group | Article step hangs; duplicate runs |
| Q05 Alert insight | 8 | **10** | SAP CIs with owner and group, a kernel change, alerts grouped | English notes; no time-to-full; dependency direction |
| Q06 Alert automation | 4 | **10** | Ask for a grouping automation, the only kind the agent builds | Response automations are only a link; no replay |
| Q07 Knowledge | 3 | **11** | 3 Spanish articles in the open "Knowledge" KB | 30 articles (R10); 7 more questions |
| Q08 Software | 7 | **10** | Two variables (reason, laptop), the persona's laptops | English description (protected item); duplicate not spotted |
| Q09 Status | 6 | **9 / 5** | Approval, overdue and on-hold data | Per ticket 9; the overview reads state only |
| Q10 Wrong door | 9 | **9** | Spanish persona | No catalog item named, no conversion |
| Q11 Analytics | 3 | **9** | Persona role `now.assist.creator.analytics`, tested wording | No numbers or narrative; wording-sensitive |
| Q12 Smart Documents | 5 | 5 | Not retested | Redaction failed; English; silent off-document |
| Q13 Governance | 8 | 8 | Root cause found; one asset Managed | Value needs Managed assets (R17, R22) |

**What the two days taught us**, in addition to L1 to L6:

| # | Lesson | Steps |
|---|---|---|
| L7 | **The user's language decides the answer's language**, not the question or the instructions. Every demo runs as a Spanish persona; autonomous notes run as the system, in English. | Q01, Q05, all |
| L8 | **Most poor answers were missing data, roles or content, not weak AI.** Q07 went from 3 to 11 with three articles and the right knowledge base; Q05 went from 8 to 10 with an owner and a change on the CI. | Q02, Q05, Q07, Q09 |
| L9 | **Each agent can do less than its name says.** The alert automation agent builds only grouping rules, the status overview reads only the state, the on-call agent is read-only, and the chart agent draws but never states numbers. The demo asks for what they can do; the rest is a build. | Q02, Q06, Q09, Q11 |
| L10 | **Missing roles fail silently or degrade the answer.** Without the analytics role, the panel answered with search links. Without `oc_read`, it said "could not be retrieved". | Q02, Q11 |
| L11 | **The 22 October upgrade broke the old AI Value Dashboard.** It reads a removed table. The new value pipeline only computes for Managed assets, and none were. | Q13 |
| L12 | **Conversations nobody ends stay "in progress".** 99 of the 106 open plans are our own test chats, not failures. | Q13 |

## Sprint 0 status

Status: **Done**, **Partial** (started, with what's left), **Open**. The task text is unchanged from
28 October.

### Routing and entry points (L1)

| ID | Task | Status on 29 October |
|---|---|---|
| R1 | Keep the LEAP agent out of general routing | **Open.** Worked around: SLA questions route to the Global copy (Q01) |
| R2 | Suggested prompts per workspace | **Open** |
| R3 | Record context per entry point | **Partial.** Confirmed: the panel needs the record open, or the number in the question (Q02, Q10) |
| R4 | Panel defects to support | **Open.** New ones to add: duplicate runs from one message (Q04), panel freezes on long runs (Q02), empty bubbles in the ESC chat (Q09) |

### Personas and access (L2)

| ID | Task | Status on 29 October |
|---|---|---|
| R5 | 6 personas with real roles | **Partial.** One analyst persona, "Analista AIT (ES)": Spanish, itil, panel, Explain SLA, analytics, `oc_read`, in DEMO.PI.Identity, manager set. 3 SAP users exist for the rota. Still needed: an operations engineer with an Event Management role (Q05, Q06 run as admin today), a change manager, an MI manager, and an employee separate from the analyst |
| R6 | ACL roles for the 8 agents | **Open** |
| R7 | Work plan trigger not as `system` | **Open** |
| R8 | Standard change decision | **Open** |

### Data (L3)

| ID | Task | Status on 29 October |
|---|---|---|
| R9 | SAP service and CIs with support groups | **Partial.** SAP AppSRV01, AppSRV02 and LoadBal01 have group DEMO.PI.SAP and an owner; events bind and route. CI naming and the rest of the SAP CIs are open |
| R10 | 30 client articles; remove the shared secret | **Partial.** 3 Spanish articles (VPN, MFA, SAP V1 801) in the open KB; 27 to go. The IT KB is readable only by ACME employees: decide the KB model |
| R11 | Clean incidents, load 6 months, clustering | **Open** |
| R12 | SAP on-call rota; assigned work | **Done** for the rota (weekly; shift end not shown). Assigned work exists for the analyst persona only |

### Hand-offs (L4)

| ID | Task | Status on 29 October |
|---|---|---|
| R13 | Create Incident agent in the ESC chat | **Open** |
| R14 | Alert to incident with the AI insight | **Done by B7** for incidents created from an alert ("Quick Incident"): the incident gets the AI summary, CI, owner, changes and related alerts. Still open: the OOB rule "Create Incident with AI Insight" is active but created no incident for 4 test alerts |
| R15 | "Unable to create knowledge article" | **Partial.** Narrowed: the same insert works through REST and fails only inside the agent; as the persona the step now hangs. Workaround: generate the article from the form |
| R16 | Sentiment off for event incidents | **Open** |

### Governance and measurement (L5)

| ID | Task | Status on 29 October |
|---|---|---|
| R17 | AI Control Tower: Managed assets | **Partial.** 1 of 336 moved to Managed as a probe (no approvals or tasks triggered); waiting for the value jobs before moving the demo skills |
| R18 | Test MCP owner or deactivate | **Open** |
| R19 | Guardian at BLOCK | **Open** |
| R20 | Weekly AI review | **Open** |
| R21 | Close stuck plans | **Open.** Sized: 106 in progress, 99 from our QA |
| R22 | Indicators and AI Value | **Partial.** Root cause found (L11). Fix = R17, then use the AI Control Tower value view, not the old dashboard |
| R23 | Pause AI Agent Advisor until R11 | **Open** |

## Builds from the quality work

Gaps that configuration can't close. Each is a Global build in an `AIT-` update set, with no scoped
app: a new Global workflow and agent, a script tool on an OOB agent, or a business rule. Six were
built and tested as the persona on 29 October (`../evidence/quality-2026-10-28/builds-2026-10-29.md`,
scripts in `../build/`). Effort: S = hours, M = 1 to 3 days.

| ID | Build | Closes | Status 29 Oct |
|---|---|---|---|
| B1 | **Analytics narrative:** Global workflow "Comparar periodos (AIT)" with a GlideAggregate tool: totals per period, the change, and the groups that explain it | Q11: "which priority explains the difference" | **Done, 11.** Exact in 3 of 3 runs. The chart phrase still goes to the OOB chart agent: ask the numbers in a new chat |
| B2 | **Request overview:** a tool on the OOB status agent for approval, due date, overdue and "waiting for you" | Q09 overview, from 5 | **Done, 11 to 12.** Action, approver and days overdue right in Spanish and English questions |
| B3 | **On-call with action:** shift end, handover and escalation line; "assign to the person on call and leave a note", supervised | Q02, from 9 | **Done, 11.** The user confirms twice before the assignment |
| B4 | **Alert response proposal:** a tool that writes an inactive `em_alert_management_rule` from the alert's fields, with a replay count | Q06 response automations | **Done, 11.** As the persona "Operador AIT (EM)": inactive rule with the Create Incident action and a right replay; a second run returns the existing rule |
| B5 | **Alert analysis copy:** time to full, dependency direction, change number, owner, Spanish | Q05, from 10 | **Partly covered by B7** (change number and owner at hand-off). Time to full and Spanish still need a copy of the OOB agent (S) |
| B6 | **Catalog item:** Spanish texts, and the user's open requests shown before submitting | Q08, from 10 | **Done, 11.** The duplicate shows in the summary; the chat card keeps the English item name |
| B7 | **Alert to incident (= R14):** the incident gets the AI summary, CI, owner, recent changes by number and related alerts | Hand-off L4 | **Done, 11.** One note per incident, from a group or a member alert |
| B8 | **Similar-incident citations:** Global workflow "Plan con incidencias similares (AIT)"; each step cites the incidents it comes from, with the evidence count and a group check | Q03 | **Done, 11 to 12.** Recommends a group change only with 2 or more matches |

Seen in every build: the answer follows the language of the user's profile, not of the question (L7).

## Implementation plan from here

```mermaid
gantt
  title From quality fixes to Sprint 0
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  section Now
  Gate the demo steps (5 runs, both languages)  :g1, 2026-10-29, 3d
  Q12 and Q13 retests                           :g2, 2026-10-29, 3d
  Demo rehearsal                                :milestone, m0, 2026-10-30, 0d
  section Sprint 0
  Personas and access R5-R8                     :s2, 2026-11-02, 4d
  Routing R1-R4                                 :s1, 2026-11-02, 3d
  Data R9-R12                                   :s3, 2026-11-04, 7d
  Builds B1 B2 B3 B6 B7 B8 (done)               :done, b1, 2026-10-29, 1d
  Builds B4 B5                                  :b2, 2026-11-04, 4d
  Hand-offs R13-R16                             :s4, 2026-11-06, 6d
  Governance R17-R23                            :s5, 2026-11-09, 5d
  Retest all 13 steps on the gate               :milestone, m1, 2026-11-13, 0d
  section Then
  P1 Assist                                     :p1, 2026-11-16, 2026-12-04
  P2 Copilot                                    :p2, 2026-12-07, 2027-01-15
```

### Now to 1 November: make the demo steps pass the gate

1. **Q13:** check the probe asset after the value jobs (07:36 and 10:11 UTC on 29 October). If value
   appears, move the demo skills to Managed (R17); otherwise unmanage the probe and keep AI Agent
   Analytics as the governance view.
2. **Q12:** retest as the persona, with a PDF exported from a word processor; retest redaction.
3. **Gate runs:** 5 runs per step for Q01, Q02, Q05, Q06, Q07, Q08, Q09 per ticket, Q10 and Q11, in
   Spanish and English, scored on the 6 criteria. A step that falls below 10 in any run goes back to
   its fix list.
4. **Housekeeping:** end the QA chats (R21); switch the test user back to the Default update set.
5. **Rehearse** [the demo script](../08-demo-script.md) end to end, including its preparation list.

### Sprint 0, 2 to 13 November

In this order, because each row depends on the one before:

1. **Personas (R5) first.** Every later test runs as a persona, including an operations engineer so
   Q05 and Q06 stop running as admin.
2. **Routing (R1, R2)**, so free-text requests reach the right agent.
3. **Data (R9 to R11)**: the SAP service model, 30 articles, 6 months of clean incidents. Most
   remaining insight gaps depend on it (L8).
4. **Build left: B5.** B1 to B4 and B6 to B8 were built on 29 October, and B1, B2, B3, B6, B7 and
   B8 passed the 5-run gate the same day.
5. **Hand-offs (R13, R15, R16 and the OOB alert rule of R14).**
6. **Governance (R17 to R23)**, so the 15 January gate has numbers: managed assets, blocked runs,
   value.
7. **Retest all 13 steps on the gate** on 13 November. The P1 work starts only on steps that pass.

## Phase 2: from answers to autonomous IT

**Added 29 October**, after the comparison of the OOB agents with the builds
([oob-vs-builds-2026-10-29.md](../evidence/quality-2026-10-28/oob-vs-builds-2026-10-29.md)). That run
changes the story to tell a client:

- **Data and configuration gave most of the gain.** With the overnight data, the OOB agents already
  score about 9 of 12 on status, on-call, recommendation and catalog.
- **Builds add the last specific fact**, which takes the answer from 9 to 11 or 12.
- **Analytics is the exception:** the OOB gives no numbers (about 2 against 11).
- **Everything so far starts with a person asking.** Autonomous IT needs agents that start from
  events, at a stated autonomy level.

Phase 2 has seven workstreams, W1 to W7. It runs alongside Sprint 0 and P1, and reuses their tasks
where they overlap instead of repeating them. Effort: S = hours, M = 1 to 3 days, L = a week.

```mermaid
flowchart LR
  W1["W1 Close the builds<br/>gate, B4, B5, B7"] --> W2["W2 Data readiness<br/>check per use case"]
  W2 --> W3["W3 Analytics<br/>SLA drivers, backlog"]
  W2 --> W4["W4 Otto acts<br/>event triggers,<br/>autonomy levels"]
  W3 --> W4
  W1 --> W5["W5 Voice<br/>mic first"]
  W4 --> W6["W6 Value and<br/>governance"]
  W5 --> W6
  W6 --> W7["W7 Repeatable kit"]
```

### Autonomy levels

Every use case gets one level, agreed with the owner, and moves up only after it passes the gate at
its current level.

| Level | Name | What the agent does | Example on everis2 |
|---|---|---|---|
| 0 | Answer | Answers a question; changes nothing | B1 analytics, B2 status |
| 1 | Suggest | Writes a proposal a person applies | B8 plan with similar incidents |
| 2 | Act with approval | Prepares the change; a person confirms or turns it on | B3 assignment (confirmed twice), B4 inactive rule |
| 3 | Act and report | Acts on its own and leaves a visible note; a person can undo it | B7 alert to incident, the alert insight agent (L6) |
| 4 | Act silently | Acts with no note | Not used in the demo |

### W1. Close the build phase (30 October to 1 November)

Extends "Now to 1 November" above.

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W1.1 | **Done 29 Oct, all pass** ([gate](../evidence/quality-2026-10-28/gate-2026-10-29.md)). 5-run gate for B1, B2, B3, B6, B7, B8 in Spanish and English, on their answer keys. Two defects fixed during the gate: B2 counted tickets opened for others, B8 answered "N/A" in 2 of 5 runs. B3 needs the incident number in the question | 10 or more in 5 of 5 runs, per language | M |
| W1.2 | **Done 29 Oct, 11.** **B4** as a persona with an Event Management role (decision P2-1): rule created inactive, Create Incident action linked, replay count right, a second run returns "already exists" | All four checks; score 10 or more | S |
| W1.3 | **B7 done 29 Oct, 5 of 5.** **B7 and Q05** with fresh alert events, plus the OOB comparison for Q05 that was skipped. Without B7 the incident gets the alert text and no note. Still open: the 5-run Q05 analysis gate, which waits for B5 | B7 note on 5 of 5 incidents; OOB score recorded | S |
| W1.4 | **B5:** Global copy of the alert analysis agent with time to full, dependency direction and Spanish notes (depends on decision 4) | Q05 at 11 or more | S |
| W1.5 | Rehearse the [demo script](../08-demo-script.md) with the builds | No step below 10 | S |

### W2. Data readiness check (2 to 6 November)

The client deliverable that follows from L8 and the OOB comparison: **what the data must contain for
each use case to work**, and a measured score of an instance against it.

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W2.1 | For each of the 13 demo steps, list the facts its answer depends on, from the answer keys and the night fixes. Examples: SLA definitions linked to the breakdown (Q01); a rota with shifts and users with phones (Q02); resolved incidents with resolution notes and KB links (Q03); CIs with owner, group and changes (Q05); articles in a KB the user can read, in their language (Q07); approvals and due dates on requests (Q09) | One row per fact, with the step it serves | S |
| W2.2 | A read-only check per fact, with a threshold. Examples: share of closed incidents with resolution notes over 50 characters; share of alerts with a CI; share of incidents with a KB link; rota coverage per group; requests with an approver | Each check is one aggregate query, no record export | M |
| W2.3 | Run the checks on everis2 and compare with the measured OOB scores | The check predicts the OOB score band (under 6, 6 to 9, 9 or more) for 10 of 13 steps | S |
| W2.4 | Client page: the checklist, how to read it, and the everis2 example | Reviewed by the owner | S |

The checks run as a script with REST reads, not inside snagentic: snagentic quarantines business
records by design.

### W3. Analytics (9 to 13 November)

Extends B1, where the build adds the most. It answers the owner's first point about SLAs at group
level: why the team breaches, not what the SLA record already shows.

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W3.1 | Pick 4 manager questions and write their answer keys: why SLA breaches rose (by group, category, priority); backlog age per group; reopen rate; top recurring causes (by CI, category and close code) | 4 answer keys, each with a reference query | S |
| W3.2 | Tool "Explain SLA breaches (AIT)": breached `task_sla` per period and group, with the drivers (reassignment count, time on hold, time to first assignment, no update for N hours) | Numbers match the reference query; drivers named in the answer | M |
| W3.3 | Tools for backlog age and recurring causes, on the B1 workflow, with the same table allow-list and `canRead` check as B1 | Same | M |
| W3.4 | Gate the 4 questions | 10 or more in 5 of 5, both languages | S |

Depends on R11 (6 months of clean incidents) for drivers that mean something.

### W4. Otto acts: event-driven agents (spike 4 November, pilots 16 to 27 November)

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W4.1 | **Read-only spike:** which triggers on everis2 can start an agentic workflow (record create or update, schedule, flow action; the 6 `sn_aia_trigger_configuration` records are inactive); which user they run as (R7: `system` was blocked 78 times); which language the notes use (L7) | A one-page answer with the trigger to use and its run-as user | S |
| W4.2 | Autonomy level per use case (table above), agreed with the owner | Decision P2-2 | S |
| W4.3 | **Pilot 1, SLA at risk (level 3):** at 75% of a resolution SLA, a work note with the likely cause, the person on call (B3 tool) and the next step. Reuses "Explain SLA (AIT)" | Note within 5 minutes on 5 of 5 test incidents; score 10 or more | M |
| W4.4 | **Pilot 2, wrong group (level 2):** on a new incident, the B8 group check proposes a reassignment with its evidence; a person approves. One group only, as in P3-1 | 5 of 5 right proposals; no change without approval | M |
| W4.5 | Guardrails for every triggered agent: a run-as user with real roles, an off switch (the trigger and `sys_gen_ai_skill_config.active`), a daily run limit, a note prefix so its writing is traceable | Off switch tested; limit tested | S |

B7 (alert to incident) is already level 3 and counts as the first event-driven case.

### W5. Voice (16 to 20 November)

Telephony stays at the entitlements gate (P4-1: no carrier). The panel microphone is the cheap
path: `sn_voice_input` is active but hidden in product
([40-platform-governance.md](40-platform-governance.md), section E).

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W5.1 | Show the microphone in product for `itil` and requesters (class A activation V10, decision 6) | Mic visible for the persona in the panel and the employee chat | S |
| W5.2 | Ask Q02 on-call, Q09 status and Q07 knowledge by voice in Spanish, on the same answer keys, plus one criterion: the transcription is right, including record numbers and SAP terms | 10 or more in 3 of 3 runs | S |
| W5.3 | Dictate a work note on an incident | Note right with no manual correction | S |
| W5.4 | Phone voice agents: the carrier decision and cost, for the entitlements gate | Decision P2-3 | – |

### W6. Value and governance (with R17 to R23)

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W6.1 | Value per use case: runs, success rate and minutes saved per run (an assumption agreed with the owner), from AI Agent Analytics and the generative AI logs | One table per week for the demo use cases | M |
| W6.2 | Human-in-the-loop register: per workflow, its level, what needs approval, who approves and how to switch it off | All AIT workflows listed | S |
| W6.3 | Weekly AI review (R20), using W6.1 and W6.2 | First review held | S |

### W7. Repeatable kit (December)

| ID | Task | Acceptance | Effort |
|---|---|---|---|
| W7.1 | List and export the `AIT-` update sets in install order; the scripts are already in `../build/` | Install order documented | S |
| W7.2 | Demo data as scripts that can run twice, keyed by business keys: personas, SAP CIs, rota, articles, incidents | A second run changes nothing | M |
| W7.3 | Install and revert checklist built from the revert rows of every build | Followed once end to end | S |
| W7.4 | Install on a second instance with Now Assist (not a PDI: Otto can't be enabled there), then gate 3 steps | Decision P2-4 | M |

### Phase 2 timeline

```mermaid
gantt
  title Phase 2 alongside Sprint 0
  dateFormat YYYY-MM-DD
  axisFormat %d %b
  section Phase 2
  W1 Close the builds               :w1, 2026-10-30, 3d
  W2 Data readiness                 :w2, 2026-11-02, 5d
  W4.1 Trigger spike                :w41, 2026-11-04, 1d
  W3 Analytics                      :w3, 2026-11-09, 5d
  W4 Pilots                         :w4, 2026-11-16, 10d
  W5 Voice                          :w5, 2026-11-16, 5d
  W6 Value and governance           :w6, 2026-11-23, 5d
  W7 Repeatable kit                 :w7, 2026-12-01, 8d
  section Sprint 0
  Sprint 0 R1-R23                   :s0, 2026-11-02, 10d
```

### Decisions for phase 2

| ID | Decision | Blocks |
|---|---|---|
| P2-1 | B4: keep the persona "Operador AIT (EM)" for the test, or name another Event Management user | W1.2. **Decided 29 Oct: keep it** |
| P2-2 | Autonomy level per use case, and which pilots may write on demo records without approval (level 3) | W4.3, W4.4. **Decided 29 Oct:** pilot 1 (SLA at risk) at level 3 and pilot 2 (wrong group) at level 2, both limited to the DEMO.PI groups so other tests on the instance are not touched; the builds keep their current levels (B1, B2 at 0; B8 at 1; B3, B4 at 2; B7 at 3). Demo data may be added as needed, every change in an `AIT-` update set with a revert step |
| P2-3 | Phone voice: carrier and budget, or the microphone only | W5.4. **Decided 29 Oct: microphone only**; phone stays at the entitlements gate |
| P2-4 | A second instance with Now Assist for the kit test | W7.4. **On hold 29 Oct:** the owner may propose a new instance in Brazil (zBoot) that also gets the accelerators |

Decision 4 (language of autonomous notes) and decision 6 (class A activations, which include the
microphone) above also block W1.4 and W5.1.

## What changes in the roadmap

| Item | Change | Why |
|---|---|---|
| P0 | Add R1 to R23 (Sprint 0) and B1 to B8. P0-3 (guardians) becomes R19; P0-5 (data) is detailed in R9 to R12 | L1 to L12 |
| P1-2 chat summarization and reply | Move to P4 or drop: there is no live-agent queue (131 chats, all Virtual Agent) | SD30 |
| P2-1 copilot agents | Depends on R1, R2, R5. Investigate problems and Analyze task trends also need R11 | SD12, KA14, problem tests |
| P2-4 change agents | Depends on R1, R5, R8, R9. Three of five failed for routing or data | Change tests |
| P2-6 knowledge health | Depends on R10. Generating KB from a topic isn't reachable; KB from a task works | KA02, KA01 |
| P3-1 triage on insert | The writing workflow runs only by trigger: test it on one group first, as a persona, with field-level approval | SD01, R7 |
| P3-6 alerts | Analysis already autonomous and CI-aware (Q05); add B5, B7 and the noise board (N8) | OP01-OP04, Q05 |
| P4-1 voice | Telephony is a placeholder (Twilio account `-1`). Needs a carrier decision at the entitlements gate | PG17 |
| P4-5 to P4-7 ITOM | No MID Server, no HLA core, no SRM, no ITOM Discovery: decide at the entitlements gate or simulate | OP08, OP13-OP17 |
| Governance gate (15 Jan) | Measurable entry criteria: 0 unmanaged AIT assets, 0 blocked runs in a week, inferred CSAT ≥ 4, AI value shown for the demo skills | PG07, PG12, Q13 |

## Decisions needed from the owner

**Done since 28 October:** data, configuration and activations for the quality plan (approved on the
night of 28 October); roles for the analyst persona and the SAP users (decision 2, partly).

**Open:**

1. Approve the Sprint 0 configuration changes, in update sets `AIT-P0-<stream>-<name>`.
2. Approve builds **B1 to B8** (or choose which), each a Global copy or tool in an `AIT-` update set.
3. **R17:** move the demo skills to Managed in AI Control Tower if the probe shows value.
4. **Language of autonomous notes** (alert insights run as the system, in English): change the
   instructions in a copy (B5) or accept English for operations.
5. **Knowledge base model:** client articles in the open "Knowledge" KB (used now), or a client KB
   with its own user criteria.
6. Approve the class A activations for testing, in `AIT-TEST-activations`, each with its revert step:
   - the 13 never tested: MI email content, attachment summary, slot fill, approval assistance,
     requester summary, knowledge gaps, duplicates and health, translation, security detectors,
     Conversation Evaluator, voice mic, AI Worker mode;
   - 4 found switched off: flow and subflow generation (PG06, SD23), the document extraction skill
     (KA20), and alert noise auto-close (OP02).
7. Test MCP: contact iCenter or deactivate (R18).
8. Clean-up: the test records in the [evidence README](../evidence/capabilities-2026-10-28/README.md)
   and the revert lists in [night-changes.md](../evidence/quality-2026-10-28/night-changes.md), once
   the demo is done.

## Still to test

- Q12 as the persona; Q03 rescored on its answer key; gate runs for every step (above).
- SD24 image to ticket: a person attaches an error screenshot in the chat and asks for a ticket (5
  minutes; the browser automation can't drive the file picker).
- SD31 sidebar summarization: needs a second user in the conversation.
- The 13 class A activations and 2 integrations or decisions (SMTP, web search credential), after
  decision 6.
