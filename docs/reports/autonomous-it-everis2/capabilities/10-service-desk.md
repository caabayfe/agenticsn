# 10. Service desk and ITSM fulfilment: capability assessment (everis2, 2026-10-28)

Scope: incident, request and catalog, change, problem, SLA, work allocation, email, chat and live agent,
Virtual Agent and employee agents, image to task, notification agents. Sources: the mirror of 2026-10-27
(`.../everis2/metadata/<scope>/<table>/`), `operational/plugins.yaml` and `store_apps.yaml`, `usage.md`
(180 days), the strategy repo and the P1-1 evidence. Paths below are relative to
`metadata/` unless stated.

**How state was read:**
- Skill state comes from `sn_nowassist_skill_config_status`: `active` and `in_product_active`.
- Agentic workflow state comes from `sn_aia_usecase_config_override.active`. A workflow with no override uses
  its out-of-box default, which isn't in the mirror.
- Trigger state comes from `sn_aia_trigger_configuration.active`, plus `sn_aia_trigger_config_override`.
- Agent state comes from `sn_aia_agent_config.active`.
- User role assignments are data and aren't in the mirror. Where a role matters, check it live.

## Key facts for this domain (read first)

1. **Only one ITSM trigger is live.** Each of the 5 agentic triggers in the domain (4 in `sn_itsm_aia`, 1 in
   `sn_uxc_gen_ai`) is `active: 'false'`. The exception is "Investigate and recommend incident resolution": user `malonsay`
   switched it on through `global/sn_aia_trigger_config_override/record--e90f19c6...yaml` on 2026-10-09.
   Since then it has run **once** (usage.md). Everything else in this domain runs only when someone asks.
2. **The `platform_ai_*` roles aren't inside `itil`.** In `sys_user_role_contains`, `itil` contains only
   the change agent roles (`sn_itsm_aia.sn_aia_chg_conflict`, `_quality`, `_schedule`).
   - Work Allocator, work planner, Proactive Escalation, Classify tasks, problem investigator, trends and
     surveys each need an explicit `sn_uxc_gen_ai.platform_ai_*` role.
   - An analyst with only `itil` sees none of these agents (inferred from the skill role masks in
     `sys_agent_access_role_configuration`).
3. **The employee channel works, but nobody uses it.** In 180 days the logs show:

   | Capability or workflow | Calls or runs |
   |---|---|
   | Default VA Workflow | 16 |
   | Unified Skill Slotfill | 14 |
   | VA Input Response Generation | 11 |
   | Conversational catalog request | 4 |
   | Task Status | 1 |

   The strongest user signal in the domain is **Generate my work plan: 80 runs**, the second-highest workflow
   on the instance.
4. **Email-driven AI is wired but switched off at three layers:**
   - the inbound action `sn_notif_agents/sysevent_in_email_action/trigger-intent-to-action--f4b34c5a...yaml`
     is `active: 'false'`;
   - the only intent action is the default "QnA" reply (`sn_notif_agents_notification_intent_action/qna--b55ab32e...yaml`),
     which is also `active: 'false'`, and no intents exist;
   - SMTP is off.
5. **"Email Insight" isn't an ITSM skill.** Its 8 calls belong to `sn_spm_gen_ai`
   (`sn_spm_gen_ai/sys_one_extend_capability/email-insight--5ef95661...yaml`: "insight by comparing previous and
   current snapshot of ... project, portfolio"). Leave it out of the service desk story.

## P1-1 skills (already validated; tweaks only)

Incident, request, RITM, catalog task, change and problem summarization; sentiment; resolution notes; KB
generation; activity response; email recommendation. All are `active`, in product for `itil`
(`sn_itsm_gen_ai/sn_nowassist_skill_config_status/`). Tweaks this assessment adds to `gaps.md`:

- **Request and catalog task responses:**
  - Request, RITM and catalog task activity response are active (`sn_itsm_gen_ai`, applicability `sc_request`,
    `sc_req_item` and `sc_task`), but P1-1 tested only the incident version.
  - Add one RITM and one SCTASK reply to the P1 script.
  - The NACM variants are the mobile agent versions: test them only if Now Mobile Agent is in the demo.
- **Sentiment:**
  - `Sentiment Analysis Scheduled Job(Incident)` runs every 15 minutes
    (`sn_itsm_gen_ai/sysauto_script/sentiment-analysis-scheduled-job-incident--17c91e3e...yaml`) and accounts for
    146 calls.
  - The historical backfill never ran (`sn_uxc_gen_ai.sentiment_historical_script_processed_records=0`,
    `sn_uxc_gen_ai.enable_sentiment_analysis=false`).
  - Sentiment is the input for Proactive Escalation (below), so run the backfill before the escalation tests.
- **Summary input fields:** `sn_uxc_gen_ai.record.summary.input_fields` and the `.new`, `.wip` and `.resolved`
  variants are empty (maint). Set them in Now Assist Admin, adding business service, CI, SLA stage and VIP.
- **Resolution notes:** keep `sn_uxc_gen_ai.resolution.min_word_count=6`. Couple it with the Wrap-up workflow (below)
  instead of the bare skill.

---

## A. Incident: intake, triage and investigation

### Triage and categorize ITSM incidents
- **Kind / where:** agentic workflow (`sn_itsm_aia`).
  - Team: Categorize ITSM incident AI agent, Classify service and CI AI agent, Link major incident or problem AI Agent.
  - Surfaces: Now Assist panel ("Triage INC…") and a record trigger.
- **State on everis2:**
  - Workflow override is `active: 'true'`, with a fixed `run_as_user` (82ef6be4…;
    `sn_itsm_aia/sn_aia_usecase_config_override/`).
  - Trigger `incident--68fd79f4...yaml` is `active: 'false'`. Its condition is
    `short_descriptionISNOTEMPTY^stateCHANGESTO2^ORstate=1^priorityIN3,4,5`, so P1 and P2 are deliberately
    excluded: they go to major incident handling.
  - Usage: 0 runs. (Triage and investigate *alerts*, 76 calls, is ITOM.)
- **Persona and business problem:**
  - Who: service desk lead.
  - Pain: wrong category, missing service and CI, and no link to the ongoing major incident. These cause
    reassignments, and an incident without a CI blocks impact and change correlation.
  - How often: every P3 to P5 ticket, the bulk of volume.
- **Business logic to enable it:**
  - Trigger: on create, or on the move to In Progress, for P3 to P5 with a short description.
  - Writes: category and subcategory, business service, offering and CI, and a parent major incident or
    problem link.
  - Human checkpoint: at L3 the agent writes and the analyst corrects. Log every write as a work note.
  - MI surge rule: with `sn_itsm_aia.mi_linker.similar_inc_threshold=10` and `similar_inc_window=30`, it
    *proposes* a new major incident when 10 similar incidents arrive in the window. Keep that proposal approved
    by a person (major_incident_manager).
- **Tweaks to make it useful:**
  - Copy as `AIT Triage and categorize ITSM incidents` and give the copy its own trigger.
  - Run as a dedicated integration user with `itil` (not admin), so writes are attributable.
  - Data is the real blocker: 393 of 430 open incidents have no CI and 419 no service (brief). The Classify service
    and CI agent picks from the caller's assigned CIs and the service and offering tree. Without CSDM data
    (P0-5) it returns empty, so demo only the category step until the data is loaded.
  - Language: categories are English choice labels and descriptions arrive in Spanish. Test with Spanish short
    descriptions before demoing.
  - Decide overlap with **Classify tasks** (Record field value prediction AI agent) and **Issue readiness**. Use
    this workflow for incidents and keep Classify tasks for other task tables.
- **Validation test:**
  1. As an itil user in SOW, create an incident with short description "No puedo conectar a la VPN desde casa",
     caller Mandy Mcdonnell, priority 4.
  2. Open the Now Assist panel and type "Triage INC<number>".
  3. Expected: category Network / VPN, a proposed service (once data exists), and a work note per agent.
  4. Then set the AIT trigger active and repeat with a new incident: the fields are filled without the
     panel, within about a minute, and AI Agent execution logs show the run.
- **Value / effort:** High / Low for category only (switch on, copy); Medium for the service and CI part (needs P0-5 data).

### Investigate and recommend incident resolution
- **Kind / where:** agentic workflow (`sn_itsm_aia`).
  - Team: ITSM incident resolution plan investigation AI agent.
  - Surfaces: Now Assist panel and a record trigger.
- **State on everis2:**
  - The trigger `incident--86c393a5...yaml` is inactive in its base record but **active through the
    override** (2026-10-09, malonsay).
  - Condition: `stateCHANGESTO2^assigned_toISNOTEMPTY^priorityIN1,2,3,4`, run as `assigned_to`, notifications on.
  - Runs: 1 in 180 days.
- **Defect (inferred):** the base plan says *use "ITSM incident resolution investigation AI agent"* (the older agent),
  but the team member is the "...plan investigation..." agent
  (`sn_itsm_aia/sn_aia_usecase/`, compare with uc.txt).
- **Persona and business problem:** an L1 or L2 analyst who picks up a ticket. The workflow writes similar
  incidents, KB articles and recommended steps into work notes as soon as the analyst starts working.
- **Business logic to enable it:**
  - Trigger: on the move to In Progress with an assignee.
  - Output: a work note with steps and citations. It never changes state (the base plan says so).
  - Level: L3, low risk because it only writes notes.
- **Tweaks to make it useful:**
  - In the AIT copy, align the base plan with the actual team member.
  - Exclude P1: major incidents have their own process.
  - Spanish knowledge: there are no Spanish KB articles, so the notes will cite English articles. Load Spanish
    knowledge (P0-5) first.
  - Tell analysts it runs. One run in 19 days means almost nobody moves incidents to In Progress on everis2, so
    the demo script must set that state.
- **Validation test:**
  1. Assign a P3 incident to yourself and set the state to In Progress.
  2. Within about 2 minutes a work note "Investigation…" appears with similar incidents and KB links, and a
     notification arrives.
  3. In AI Agent Studio > Executions, the run shows the expected agent.
- **Value / effort:** High / Low. It is already on; it needs only checking, a plan fix and Spanish knowledge.

### Incident assist (Incident context AI agent, Additional incident context AI agent)
- **Kind / where:** agentic workflow (`sn_itsm_aia`), asked from the Now Assist panel on an incident.
  - Topics: `Incident Assist`, `- Caller Assets`, `- On-call Experts`, `- Recent Incidents`, `- Similar Incidents`
    (`sn_itsm_gen_ai/sys_cs_topic/`, discoverable).
  - The "Additional incident context" agent is marked `custom` (agents.txt).
- **State on everis2:** override active; 1 run. The old `[DEPRECATED] Incident assist` skill is off, which is correct.
  The business rule `Set roles for incident assist` is active.
- **Persona and business problem:** an analyst who needs "what else is going on for this caller or CI, and who is on
  call?" without reading 5 lists.
- **Business logic to enable it:** read-only, asked on request (L2). No checkpoint.
- **Tweaks to make it useful:**
  - On-call experts needs rotas for the assignment groups (the On-Call Scheduling plugin is active; rota data
    isn't in the mirror, so check it live).
  - Caller assets needs `alm_asset` or CI assignment to callers (data).
  - Add 3 suggested prompts to the panel: "Who is on call for this group?", "Similar open incidents?" and
    "What does this caller own?".
- **Validation test:**
  1. On an incident whose caller has assets, open the panel and ask "Show the caller's assets and recent incidents".
  2. Expected: a table of assets and incidents from the last 30 days, with links.
  3. Ask "Who is on call for Network?" and expect a name from the rota.
- **Value / effort:** Medium / Low.

### Generate Resolution Plan (Decomposition Agent, Next action recommendation AI agent) and Suggested Actions
- **Kind / where:** agentic workflow (`sn_uxc_gen_ai`) in **autopilot** mode, the only autopilot one in the domain.
  - Surfaces: incident form and SOW "resolution plan" card.
  - Skills: `Generate Resolution Plans Skill Config` (in product, mobile on), `Step Decomposer`
    (role `platform_ai_decomposition_agent`), `Recommend next tool` (role `platform_ai_suggested_actions`).
- **State on everis2:** override active, 0 runs.
- **Persona and business problem:** an L1 analyst on an unfamiliar issue. The workflow gives a step-by-step plan
  built from similar records, knowledge and the web (shift-left).
- **Business logic to enable it:**
  - Asked on request, or on open of the incident.
  - Writes plan records. Suggested Actions runs a step only after the user clicks.
  - Level: L2, even though the mode says autopilot; executing a step stays user-confirmed.
- **Tweaks to make it useful:**
  - Grant `sn_uxc_gen_ai.platform_ai_grp_workflow` to the demo analysts.
  - Disable web research for internal applications. Web search fallback is on in VA
    (`sn_nowassist_va.websearch_fallback_enabled`).
  - Feed it resolved incidents with good close notes (data).
- **Validation test:** open a P3 Outlook incident in SOW, click Generate resolution plan, and expect 4 to 7 steps
  with sources. Click a "suggested action" on one step and confirm it asks before running.
- **Value / effort:** Medium / Medium. It overlaps with Investigate; pick one for each demo persona.

### Wrap-up and resolve incident
- **Kind / where:** agentic workflow (`sn_itsm_aia`).
  - Team: Incident resolution details, Incident known error article, Incident knowledge article agents.
  - Surfaces: Now Assist panel ("Resolve INC…") and a trigger flow.
- **State on everis2:**
  - No workflow override, so the out-of-box default applies.
  - The trigger flow `Incident resolve agent trigger` (`sn_itsm_aia`) is `active=false`, status published.
  - Usage: 0 runs. The bare skills Record Resolution (5) and Generate Knowledge Article (5) came from the P1 test.
- **Persona and business problem:** an analyst at closure. Today the analyst writes the notes, decides whether
  knowledge is needed, and writes a known error. Most never do the last two.
- **Business logic to enable it:**
  - On resolve: write resolution notes, then search for an existing article. If none exists, create a KB or KE
    *draft* for a knowledge manager to approve (L3).
  - P3-8 has this. Make it an incident-only ITSM step and leave the LEAP problem part to ITOM.
- **Tweaks to make it useful:**
  - Run it on resolve only when the resolution code is "Solved (Permanently)", so workarounds don't create KB noise.
  - Set the KB language to the caller's language (`sn_km_gen_ai.enable_kb_gen_ai_language_picker=true` already).
  - The draft goes to a specific knowledge base: choose "IT" and its workflow.
- **Validation test:**
  1. In the panel, type "Resolve INC<number>".
  2. Expected: proposed close notes, a "no matching KB, create draft?" question, and a KB draft linked to
     the incident after you confirm.
  3. Then activate the AIT trigger and repeat by clicking Resolve.
- **Value / effort:** High / Low to Medium.

### Major incident email content recommendation
- **Kind / where:** skill (`sn_itsm_gen_ai`). Applies to `incident_alert_task` with context `emailTemplate`, used by
  the communication tasks of the major incident communication plan in SOW.
- **State on everis2:** `active`, **in product off** (`in_product_active: 'false'`, roles `major_incident_manager`),
  0 calls.
- **Persona and business problem:** a major incident manager who must write stakeholder updates every 30 to 60
  minutes in the middle of a bridge.
- **Business logic to enable it:** when a communication task is due, the email composer offers a draft built from
  the major incident timeline. The manager edits and sends (L1 to L2).
- **Tweaks to make it useful:**
  - Turn in-product on for `major_incident_manager`.
  - Create one communication plan with business and IT audiences (`comm_plan_type_lookup` exists in
    `sn_itsm_gen_ai`).
  - Pair it with Sidebar discussion summarization for the bridge.
  - SMTP is off, so the demo shows the draft and `sys_email` only.
- **Validation test:**
  1. Promote an incident to major (MIM workspace) and open its communication plan.
  2. On the "Initial notification" task, click Compose.
  3. Expected: AI draft with impact, current status and next update time; send it, and it lands in
     `sys_email` as send-ready.
- **Value / effort:** High / Low. Strong demo moment for very little configuration.

### Generate post incident reviews
- **Kind / where:** agentic workflow (`sn_itsm_aia`), team "Post incident review AI agent" (record type `promoted`).
  Trigger `incident--48c67897...yaml`.
- **State on everis2:**
  - Trigger `active: 'false'`. Condition: `stateCHANGESTO6^major_incident_state=accepted^assigned_toISNOTEMPTY`,
    run as assignee.
  - Its flow `Incident - MIM post incident report - 04c67897…` is a **draft**.
  - Usage: 0 runs.
- **Persona and business problem:** a major incident manager. A post incident review takes hours and is often late
  (`sn_sow_inc.pir.publish.hours=24`).
- **Business logic to enable it:** on major incident resolve, draft the review (timeline, impact, root cause,
  actions), then a person reviews and publishes it (L3).
- **Tweaks to make it useful:** publish the flow in the AIT copy, and feed it a major incident with a real timeline
  (work notes, child incidents, a linked change).
- **Validation test:** resolve an accepted major incident, then expect a review draft (PDF preview in SOW) within
  minutes, assigned to the major incident manager.
- **Value / effort:** Medium / Low.

### Attachment summarization for new incidents (not in the strategy repo)
- **Kind / where:** skill pipeline (Document intelligence) for `incident`.
  - Config: `sn_itsm_gen_ai/di_attachment_summarization_config/` (Incident, `active: 'true'`).
  - Trigger: business rule `Attachment Summ for New Incident (ITSM)`, `after` on `incident`, **`active: 'false'`**
    (`sn_itsm_gen_ai/sys_script/attachment-summ-for-new-incident-itsm--ff47f5b9...yaml`).
- **State on everis2:** off; no usage.
- **Persona and business problem:** an analyst receiving tickets with screenshots, logs or PDFs attached by email or
  portal. They have to open every file.
- **Business logic to enable it:** on insert with an attachment, summarize it into a work note, and with OCR for images.
  L3, low risk because it only writes notes.
- **Tweaks to make it useful:**
  - Activate the business rule in an AIT update set.
  - Cap file size and types.
  - Exclude HR-sensitive categories.
  - Check that the guardian redacts personal data.
- **Validation test:** create an incident from the portal with a screenshot of an Outlook error attached, then expect
  a work note "Attachment summary: …" quoting the error code.
- **Value / effort:** Medium / Low.

### Find catalog item AI agent ("wrong door" tickets; not in the strategy repo)
- **Kind / where:** AI agent (`sn_itsm_aia`). It finds catalog items for an incident and posts links in additional
  comments. It is only a template with no channel (agentdesc.txt).
- **State on everis2:** agent template, not in any workflow.
- **Persona and business problem:** a service desk lead. A share of "incidents" are really requests ("I need Visio").
  The agent sends the caller to the right item and lets the analyst close the incident as wrong channel.
- **Business logic to enable it:** add it to the AIT Triage copy as a fourth, conditional agent that runs when the
  category is "Request" or the text matches request intent. It posts the item link as a comment, and the analyst
  confirms the closure (L2, then L3).
- **Tweaks to make it useful:** the catalog has 86 active items, many legacy (iPhone 6s, 2005 "Paper and Supplies";
  `../cat.txt`). Clean it to about 20 curated IT items with good descriptions first; this also fixes Catalog Agent.
- **Validation test:** create the incident "Necesito una licencia de Visio" and run the AIT triage. Expected: a
  comment with a link to "Non-standard software request" or "Install Software".
- **Value / effort:** Medium / Low.

---

## B. Work allocation, prioritisation and SLA

### Help Optimize Team Productivity (Work Allocator AI Agent)
- **Kind / where:** agentic workflow (`sn_uxc_gen_ai`), asked from the panel or a schedule.
  - Skills: `Optimal Ticket Assignment` and `Language Detection for Work Allocator`, both in product, roles
    `platform_ai_work_allocator`.
  - Role chain: `platform_ai_help_allocate_work` contains `platform_ai_work_allocator`.
- **State on everis2:** active; no trigger; 0 runs. Advanced Work Assignment is active, but **AWA for Incidents
  (`com.snc.incident.awa`) is inactive** and the only AWA queues are chat async and phone (`global/awa_queue/`,
  `sn_va_as_service/awa_queue/`).
- **Persona and business problem:** a team manager balancing backlog by workload, skill and language every morning
  and after absences.
- **Business logic to enable it:**
  1. Scheduled every 2 hours for one group (P3-2).
  2. The agent proposes reassignments.
  3. The manager approves them in bulk (L3).
  4. Language detection routes Polish or Portuguese tickets to speakers.
- **Tweaks to make it useful:**
  - Grant `platform_ai_help_allocate_work` to the manager persona.
  - Give each demo analyst a language and skills. AWA agent skills: `glide.awa.filter_by_awa_skill=false` today.
  - Either activate AWA for Incidents (push routing) or keep the agent as the pull alternative. Don't demo both.
  - Needs at least 30 unassigned tickets in one group.
- **Validation test:**
  1. As the manager, open the panel and type "Help me assign the Service Desk backlog".
  2. Expected: a table of ticket → proposed agent with reasons (workload, language).
  3. Approve 3 rows and check that `assigned_to` changed and a work note explains why.
- **Value / effort:** High / Medium.

### Generate my work plan (Prioritize work, Update work plan, Suggested Actions)
- **Kind / where:** agentic workflow (`sn_uxc_gen_ai`) in the panel.
  - Skills: `Work planner skill config`, `Generate my work plan config` (in product for
    `platform_ai_work_planner`), `Quick Win Classifier`, `Schedule event generator`.
- **State on everis2:** override active. **80 runs in 180 days**, the most used ITSM-side workflow. Someone uses it,
  probably admins and demos (inferred).
- **Persona and business problem:** an analyst starting the day with 15 tickets and SLA timers.
- **Business logic to enable it:** on request: score by priority, SLA and quick-win; build time blocks around the
  calendar; the user approves; the plan is saved (L2).
- **Tweaks to make it useful:**
  - Grant `platform_ai_work_planner` to demo analysts (it isn't in `itil`).
  - Make sure the analysts have SLAs attached (42 `contract_sla` definitions exist, `global/contract_sla/`).
  - Calendar blocks need Outlook or Exchange calendar integration, or they stay internal.
- **Validation test:** as an analyst with 8 or more assigned tickets, type "Plan my day". Expected: an ordered list
  with SLA due times and quick wins marked. Approve it and the plan saves; asking again shows the saved plan.
- **Value / effort:** Medium / Low.

### Identify escalation signals (Proactive Escalation AI Agent, Suggested Actions)
- **Kind / where:** agentic workflow (`sn_uxc_gen_ai`). Skills `Proactive Escalation` (in product) and its config.
  Role `platform_ai_proactive_escalation`.
- **State on everis2:** no override, no trigger, 0 runs.
- **Persona and business problem:** a duty manager. It finds tickets about to breach, with negative sentiment or
  repeated chasing, *before* the customer escalates.
- **Business logic to enable it:**
  - Hourly scheduled trigger (P3-3), or on request.
  - Output: a list with reasons and a proposed action (raise priority, notify the manager, swarm).
  - Level: L3 only for notifying. Priority changes stay approved by a person.
- **Tweaks to make it useful:**
  - Run the sentiment backfill first, otherwise the sentiment signal is empty.
  - Write a one-page escalation policy KB article for the agent to follow.
  - Restrict it to VIP callers and P2/P3 so it doesn't flood.
- **Validation test:**
  1. Prepare an incident with a negative Spanish comment from a VIP caller and an SLA at 80%.
  2. Type "Which tickets need escalation?". Expected: that incident first, with the reasons "SLA 80%,
     negative sentiment, VIP".
- **Value / effort:** High / Medium.

### Explain SLA
- **Kind / where:** AI agent and workflow (`sn_uxc_gen_ai`) in the panel. Property
  `sn_uxc_gen_ai.sla_timeline_event_limit=50`.
- **State on everis2:** active; 0 runs. SLA definitions exist (42, including RITM SLAs), and the SLA Timeline and SLA
  Breakdowns plugins are active.
- **Persona and business problem:** an analyst or employee asking "why is my SLA paused or breached?". It is also
  the answer behind "Where is my ticket?".
- **Business logic to enable it:** read-only on request (L2). It can be added as a tool to the Request Status Agent
  copy for employees (L4, read-only).
- **Tweaks to make it useful:** the demo SLAs have legacy names ("P1 Resolution 4hr 24x7" and "Priority 1
  resolution (1 hour)" both exist). Keep one set active per priority, or the explanation contradicts itself.
- **Validation test:** on a P2 incident that went On Hold and back, ask "Explain the SLA for INC…". Expected: the
  definition, the pause intervals with reasons, and the remaining time.
- **Value / effort:** Medium / Low.

### On-call: Who is On Call, Manage On Call Shifts
- **Kind / where:** agentic workflows (`sn_itsm_aia`): "On Call Retrieval" and "On Call Shift Creator".
  `sn_itsm_aia.on_call.max_shift_count=3`.
- **State on everis2:** overrides active, 0 runs. The On-Call Scheduling plugin and SOW On Call are active.
- **Persona and business problem:** an analyst or manager who needs "who do I page now?". A scheduler creates
  shifts by conversation.
- **Business logic:** read on request (L2). Creating shifts needs the manager's confirmation.
- **Tweaks:** create rotas for 3 demo groups (data). Add On Call Retrieval as a tool in the escalation path (C5).
- **Validation test:** ask "Who is on call for Database tonight?" and expect a name, contact and rota. Then ask
  "Create a weekly shift for Network starting Monday" and expect a preview to confirm.
- **Value / effort:** Medium / Low (once rotas exist).

### Admin setup agents: routing and category (not in the strategy repo as a use case)
- **What:**
  - Incident routing configuration agent and `Incident Routing Rule Recommender` (skill, in product).
  - Incident Category Configuration AI Agent and `Industry Category Recommender` (in product).
  - CAB, change model, risk and schedule configuration agents.
- **Use:** client onboarding accelerator. Analyse 6 months of history, then propose a category tree and assignment
  rules with a preview, so a person approves them.
- **Value / effort:** Medium / Low for delivery teams. Not an end-user demo.

---

## C. Request and catalog

### Catalog Agent, Conversational Catalog Requests and Multi-Turn Catalog Ordering
- **Kind / where:**
  - Agent: Catalog Agent (`sn_now_assist_cr`).
  - Skills: `Conversational Catalog Requests` (active, **in product off**, role mask `public`) and
    `Now Assist Multi-Turn Catalog Ordering` (`sn_nava_config`, active, in product).
  - Topics: "Request catalog item (LLM)" and "End state card for Catalog Request".
  - Surfaces: Virtual Agent and Now Assist in the employee portal.
- **State on everis2:** active. Usage: Conversational catalog request 4, Unified Skill Slotfill 14.
  - `sn_now_assist_cr.enable_knowledge_graph=true`
  - `enable_alternative_translation=false`
  - `recommend_form_question_threshold=10`: items with more than 10 questions are sent to the form.
- **Persona and business problem:** an employee who doesn't know which item to pick or how to fill 15 variables.
- **Business logic to enable it:**
  1. The employee states a need.
  2. The agent finds the item and asks only for missing variables; the knowledge graph pre-fills manager,
     location and assets.
  3. The employee confirms and the agent submits.
  4. The approval follows.

  Target L3 for items without cost; items with cost always go through approval.
- **Tweaks to make it useful:**
  - Curate 15 to 20 items, with a short description that says when to use the item, and variables with help text.
    Retire the legacy items (2005 to 2017).
  - Spanish: item names are English. Set `sn_now_assist_cr.enable_alternative_translation=true` and translate the
    curated item names in `sys_translated_text`, or the Spanish search fails (inferred).
  - Turn in-product on for Conversational Catalog Requests if it should also run in the Now Assist panel for
    agents ordering on behalf of users.
- **Validation test:**
  1. In the Employee Center chat, as Mandy Mcdonnell, type "Necesito Miro para un proyecto".
  2. Expected: the Miro item is proposed, 1 or 2 questions are asked in Spanish, and a summary card is shown.
     Confirm, and REQ/RITM numbers come back.
  3. Check that the RITM variables are filled.
- **Value / effort:** High / Medium (mainly catalog curation).

### Catalog item form slot fill (`sn_sc_form_assist`)
- **Kind / where:** skill on the catalog item form in the portal: a free-text box fills the variables.
- **State on everis2:** app installed ("AI slot-filling for catalog items" 1.4.5), but the skill has **no status
  record** (never activated). The role mask is limited to admin (`b0594050…`).
- **Persona and business problem:** an employee on a long form. One sentence fills it.
- **Business logic:** on the form, the user types a description and the variables are pre-filled for review (L1).
- **Tweaks:** activate it in Now Assist Admin for the curated items and widen the role to `snc_internal`.
- **Validation test:** open "New virtual pc request" in the portal, type "8 GB, Windows 11, para 3 meses en
  Madrid", and expect the matching variables to be filled.
- **Value / effort:** Medium / Low.

### Catalog item generation (Catalog Builder AI)
- **State on everis2:** no skill or capability found. Service Catalog Builder is installed, but no generative skill
  is (searched `*/sys_one_extend_capability`). **Not available.** It is an entitlement question (P0-6) and isn't
  worth pursuing for the demo.

### Request Status Agent ("Where is my ticket?")
- **Kind / where:** AI agent (`sn_na_req_agent`), `custom` copy, config `active: 'true'`. Tools: list tickets,
  last update, add comment, add attachment, get and execute actions. Skill `Task Status` (`sn_nava_config`, 1 call).
  The old VA topics (`View RITM Details`, `RITM Add Comments`, `Check Ticket & Support Status`) are also active.
- **State on everis2:** active; 1 call.
- **Persona and business problem:** an employee chasing a ticket, which is the most common service desk call.
- **Business logic:** read, comment and attach on the user's own tickets (L4 safe). "Execute action" (for example
  raise urgency or cancel) should notify the assignee.
- **Tweaks to make it useful:**
  - Remove overlapping legacy topics so the router doesn't choose between them: `Check Ticket & Support
    Status`, `View And Add Comments`, and the `sn_itsm_va` RITM topics.
  - Add Explain SLA as a tool for "when will it be done?".
  - Write answers in the user's language: VA dynamic translation is off
    (`com.glide.cs.dynamic.translation.enable.virtual_agent=false`).
- **Validation test:** as Mandy Mcdonnell in the portal chat, type "¿Cómo va mi incidencia de Outlook?". Expected:
  the ticket found, its status and last comment in Spanish. Then type "Añade que sigue fallando" and check that the
  comment appears on the ticket.
- **Value / effort:** High / Low.

### Approval Assistance Agent and ApprovalChecklistGeneration
- **Kind / where:** AI agent (`sn_na_req_agent`). Tools: list approvals, fetch details, Approval User Knowledge
  Graph, Checklist Generation, Approval Processor (approve or reject one at a time). Skill
  `ApprovalChecklistGeneration` (active, in product off).
- **State on everis2:** **agent config `active: 'false'`**
  (`sn_na_req_agent/sn_aia_agent_config/record--4059d028...yaml`).
  - `sn_na_req_agent.approval_checklist.search_profile_sources` is empty, so the checklist has no policy source.
  - The Intelligent approvals plugin is inactive.
  - The legacy VA topics "Approve/Reject Sysapproval Approver" and "Show Approval Details-LLM" are active.
- **Persona and business problem:** a manager with pending approvals who doesn't know what to check.
- **Business logic:** on request, list pending approvals, generate a checklist per approval from the policy KB and
  requester attributes, and let the manager approve or reject one at a time (L2).
- **Tweaks:**
  - Activate the agent config.
  - Write 3 approval policy KB articles (software, hardware, access) and point the property at that knowledge
    source.
  - Retire the legacy approval topics.
- **Validation test:** as the requester's manager, type "Show my pending approvals" in chat. Expected: the list.
  Ask "What should I check for RITM…?" and expect a checklist citing the policy. Approve it, and check the
  `sysapproval_approver` state and the RITM stage.
- **Value / effort:** Medium / Low.

---

## D. Employee-facing Virtual Agent (Now Assist in VA)

### Create Incident AI Agent and the Default VA Workflow
- **Kind / where:**
  - Agent: Create Incident AI Agent (`sn_itsm_aia`, `nap_and_va`). It tries self-service first, then logs.
  - Topics: `Create Incident with VA`, `Predict Incident Service and Category`, `Similar Open Incident Search`
    (`sn_itsm_aia`), and `Create Incident-LLM` (`sn_itsm_gen_ai`).
  - Workflow: "Default VA Workflow" (`sn_nowassist_va`, override active).
- **State on everis2:** Default VA Workflow 16 runs; VA Input Response 11.
  - `sn_nowassist_va.now.assist.generic.ticket.fallback.record.producer` and `...fallback.subflow` are **empty**, so
    when nothing matches, "Create generic ticket" has no target.
  - Spanish NLU keyword topics by jcolommo (`abrir_incidencia_it`, `resolver_inc_it`, `resolver_ritm_it`, several
    `*_redirection_topic`) are active and discoverable next to the LLM topics (topics.txt).
- **Persona and business problem:** an employee reporting an issue in chat in Spanish, Polish or Portuguese.
- **Business logic:**
  1. Search knowledge and similar open incidents.
  2. Offer a fix.
  3. If declined, create a categorised incident with service prediction and give back the number (L3).
- **Tweaks to make it useful:**
  - Set the generic ticket fallback to the standard "Create Incident" record producer.
  - Retire or deprioritise the custom keyword topics, which compete with LLM topic discovery (inferred).
  - Turn VA dynamic translation on (P1-3).
  - Set `sn_nowassist_va.enable_suggested_queries=true` with 4 prompts ("Report a problem", "Request software",
    "Where is my ticket?", "Reset password").
- **Validation test:**
  1. In the portal chat, type "Teams se cierra solo al compartir pantalla".
  2. Expected: a KB answer or troubleshooting topic first; say "no funciona", then an incident is created with
     category Software and a number is shown.
  3. Check the new incident: caller set, description in Spanish, category filled.
- **Value / effort:** High / Low.

### Deflection Ticket Response, Now Assist Q&A and web search fallback
- **Kind / where:**
  - `Deflection Ticket Response` (`sn_itsm_gen_ai`, active, in product): an answer shown before a ticket is
    submitted.
  - `Now Assist Q&A` (`sn_nava_config`).
  - Multi-context Synthesized QnA: 16 calls.
  - `Deflection Query Rephrase` is off.
- **State on everis2:** active; `com.glide.cs.va.deflection_tracking.enable=true`;
  `sn_nowassist_va.websearch_fallback_enabled=no_response_from_aisearch,no_response_from_llm`.
- **Persona / problem:** employees with known issues. The goal is fewer tickets.
- **Tweaks:**
  - Spanish KB content is the prerequisite (0 Spanish articles).
  - Turn off web fallback for company-specific questions, or restrict it to approved domains, to avoid external
    answers about internal systems.
  - Report the deflections from VA analytics. `sn_nowassist_va.nextwave_anlaytics_enabled=false` today, so turn it
    on.
- **Validation test:** ask "¿Cómo configuro la VPN en casa?" and expect a synthesized answer citing the Spanish KB
  article, with a "Did this help?" prompt. The deflection is counted in the VA analytics dashboard.
- **Value / effort:** High / Medium (knowledge content).

### Conversational subflows and actions (`sn_conv_fa`, not in the strategy repo)
- **Kind / where:** skill `Subflows and actions` (active, in product; applicability
  `conversational_subflows_actions`). It exposes Flow Designer subflows and actions as chat skills without
  building topics.
- **Persona / problem:** an employee who wants an action done, not information: "add me to the Teams-Madrid group",
  "extend my VPN access".
- **Logic:** publish 3 AIT Global subflows as conversational actions, each with an input schema and a confirmation
  step (L3 for low-risk actions).
- **Tweaks:** Global only (`AIT -` flows). Each flow checks the caller's entitlement. Audit by writing a RITM or a
  work note.
- **Validation test:** ask "Añádeme al grupo Teams-Madrid". Expected: confirmation, the subflow runs, and a
  `sys_user_grmember` row plus an audit record exist.
- **Value / effort:** Medium / Medium.

### Process images for new tasks (Image Processor, Content insights, Record management)
- **Kind / where:** agentic workflow (`sn_uxc_gen_ai`). Skill `Image to task config` (active, in product, mobile on).
  The role `platform_ai_image_processor` is contained in `platform_ai_agents_role`.
- **State:** active, 0 runs.
- **Persona / problem:** a field or office employee with a photo of an error or a broken device.
- **Logic:** upload the image, extract the error text and device, propose a task, and create it after the user
  confirms (L2).
- **Tweaks:**
  - Grant `platform_ai_agents_role` to requesters, or expose it only to agents (inferred: the role must be checked
    live).
  - Limit the target table to incident.
  - Test on Now Mobile (P2-3).
- **Validation test:** in the Now Assist panel or chat, upload a screenshot of "Outlook error 0x8004010F" and type
  "Create a ticket from this". Expected: a proposed short description with the error code and category Email.
  Confirm, and the incident exists with the image attached.
- **Value / effort:** Medium / Low.

### Standard ticket page summarization (`sn_na_std_tkt`, not in the strategy repo)
- **State:** skill present, **no status record** (never activated), role mask admin.
- **Use:** a summary at the top of the Employee Center ticket page ("what happened so far") for requesters. It
  reduces "what's going on?" comments.
- **Value / effort:** Medium / Low. Activate it, widen the role to `snc_internal`, and check it on a long RITM.

---

## E. Email and notifications

### Intent to Action (Intent Identification, Intent Executor, Email Generator)
- **Kind / where:** agentic workflow (`sn_notif_agents`, override active). Inbound email action
  `Trigger Intent to Action` (**inactive**), flow `Trigger Intent to Action` (active).
- **State:** 0 runs.
  - The only intent action is the default "QnA" reply: inactive, `email_delivery_mode: Draft`, search profile
    `d2a4fdb0…`.
  - No intents are defined.
  - `sn_notif_agents.missing_inputs_execution_mode=request_missing_inputs`.
  - SMTP is off.
- **Persona / problem:** a service desk that receives email. Today mail becomes an incident through the inbound
  actions, with no understanding of intent.
- **Business logic:**
  - Inbound email → identify the intent → run the admin-defined action → reply draft (L2), then send for routine
    intents (L3).
  - 5 intents for P3-5: new issue, status request, access request, password, and "thank you, close it". Each action
    is a subflow (create incident, Request Status lookup, Catalog submit, redirect to reset, resolve).
- **Tweaks:**
  - Activate the inbound action *after* the OOB incident inbound actions (order 999 today, which is fine).
  - Keep `Draft` delivery until P2-9 acceptance metrics exist.
  - Turn inbound and outbound email on in a controlled way: a demo mailbox, allow-listed addresses.
- **Validation test:**
  1. Inject a `sys_email` record of type received ("¿Cuál es el estado de INC0025193?") from a demo user, or send it
     to the demo mailbox.
  2. Expected: the intent "status" is matched, and a draft reply is created with the status in Spanish.
- **Value / effort:** High / High (email infrastructure, intent design and subflows).

### Email Generator skill and agent
- **State:** skill `Email Generator` active and in product (`sn_notif_agents`), 0 calls. It is used by Intent to
  Action and can be used alone from the panel ("email the caller that…").
- **Value / effort:** Low on its own, since Email recommendation (P1) covers the analyst. Keep it as part of Intent
  to Action.

### Notification Agent and Notification Content Agent (admin)
- **Use:** notification clean-up for clients: build and rewrite notifications with consistent layouts and tone,
  and find duplicates. Delivery accelerator, not a demo.
- **Note:** Glide Notification Translation (`com.glide.notification.translation`) is inactive. Multilingual
  notifications need it.
- **Value / effort:** Medium / Low (delivery).

### Email Mass Communication, Compose Email Body, Email Predictive Text Assistance (`sn_uxc_gen_ai`)
- **State:**
  - `Email Predictive Text Assistance` is off (roles `email_predictive_text_assistance` and itil).
  - `sn_uxc_gen_ai.enable.compose.email=false`.
  - Mass Communication and Compose Email Body have no skill config in the family list (capability only).
- **Use:** outage mass communication to affected users, paired with Major incident email.
- **Value / effort:** Low / Medium. Use Major incident email first.

---

## F. Chat, live agent and collaboration

### Chat summarization and Chat reply recommendation
- **Kind / where:** skills (`sn_itsm_gen_ai`), active, in product for itil. Applicability `portal: esc` and `table:
  interaction`. Surface: Agent Chat in SOW.
- **State on everis2:** 0 calls. Agent Chat (`com.glide.interaction.awa`) is active, **but the only chat queue in the
  mirror is "Agent chat Async Queue", whose condition script returns `false`**
  (`global/awa_queue/agent-chat-async-queue--87da2625...condition_script.js`). Dynamic Translation for Agent Chat is
  inactive. So no live chat reaches an agent today (inferred: OOB queues may not be mirrored).
- **Persona / problem:** a live agent taking over from VA. They need the context at once and fast replies.
- **Logic:** VA hands off → summary on accept → reply suggestions per turn → summary to the interaction on close.
  The business rule `Summarize VA chats on closure` is already active (`sn_itsm_gen_ai/sys_script/`).
- **Tweaks:**
  - Create a synchronous "AIT Service Desk chat" queue on the Chat channel, with 3 agents and presence.
  - Set the VA live agent topic (`com.glide.cs.live_agent_queue` is empty).
  - Activate Dynamic Translation for Agent Chat for the Polish story (P1-3).
- **Validation test:**
  1. As an employee in the portal chat, type "Quiero hablar con un agente".
  2. The agent accepts in SOW Inbox. Expected: a summary card of the VA conversation, and reply suggestions after
     each employee message.
  3. Close the chat and check that the interaction has the summary.
- **Value / effort:** Medium / Medium. P1-2 underestimates the routing work.

### Sidebar discussion summarization
- **State:** active and in product. Applicability covers incident, change, problem, RITM, interaction and more.
  `sn_sow_collab.enable_requester_in_sidebar_discussion=true`. The standalone variant (`sn_chat_summary`) has no
  status.
- **Use:** swarming and the major incident bridge: summarize a long Sidebar thread for a newcomer.
- **Validation test:** start a Sidebar discussion on a P1 with 10 or more messages, click Summarize, and expect
  decisions and open actions.
- **Value / effort:** Medium / Low.

### Interaction and incident cluster insights (GAF ITSM dashboards)
- **What:**
  - Skills: `Incident cluster summary` (in product for incident_manager and service desk manager) and
    `Interaction cluster summary`.
  - 9 GAF ITSM Insights and Interaction dashboard skills (active, internal).
  - Dashboard "Insights and Opportunities for Incident" and "ITSM Virtual Agent analytics".
  - Business rules `[ITSM Insights] Data collection` and `[ITSM Conversational Analytics] Data col` are active.
  - The job `GAF - Run Offline Flow` runs every 30 days. "Activate topic clustering for Now Assist ITSM
    dashboard" is on demand and inactive.
- **Use:** a manager seeing clusters such as "VPN after update" with suggested actions (KB, automation, problem).
  Interaction clusters show what VA fails to deflect.
- **Note:** the large "Hierarchical capability (POV)" count (359) is GAF clustering. Part of it is probably this
  pipeline (inferred), so it already costs tokens. Make sure someone looks at the output.
- **Value / effort:** Medium / Low. Run the clustering once on P0-5 data and add it to B7.

---

## G. Change (agents in `sn_itsm_aia`)

| Workflow | State | Trigger | Notes |
|---|---|---|---|
| Assess conflicts for a change request | override active; role in `itil` | none | Needs CIs on changes (279/360 have none) |
| Assess quality of a Change Request | override active; role in `itil` and `sn_change_write` | none | Needs a quality policy document per model |
| Create outages for a change request | override active | none | Needs affected CIs |
| Suggest configuration items for a change request | override active | none | Fixes the missing CI gap from the change side |
| Generate change request plans | override active | "Change Request Planner" **inactive**: on New, non-standard, text changes, run as `requested_by` | Good L3 candidate: writes draft plans |
| Schedule a change | override active; role in `itil` | none | Needs change schedules and blackout windows |
| Create standard change request | **override `active: 'false'`**, yet 1 run in 180 days | none | Inconsistent: check whether it is reachable in the panel |
| Create standard change template proposal | override active | none | D4 |

- `Change request risk explanation` is active and in product but invisible (G5); 1 call on Now LLM.
- **Tweaks:**
  - Activate the AIT copy of the Change Request Planner trigger.
  - Run "Suggest configuration items" before conflicts and outages; chain it in an AIT workflow.
  - Write one quality policy KB article per change model.
- **Validation test:**
  1. Create a normal change, "Patch payroll DB servers", with no CI.
  2. In the panel, type "Suggest CIs for CHG…". Expected: proposed CIs; accept them.
  3. Type "Assess conflicts" and expect conflicts listed and the conflict status set.
  4. Type "Generate plans" and expect implementation, backout and test plans filled.
- **Value / effort:** High / Medium (CI data). The change domain is already well covered by D1 to D4; no new
  capability found.

## H. Problem and experience (brief)

- **Investigate problems** (`sn_uxc_gen_ai`, skill `Problems investigation skill`): active, in product off, role
  `platform_ai_problem_investigator`.
  - Value is High once problems use current states (18/30 legacy).
  - Validation: on a problem with 5 linked incidents, ask "Investigate PRB…" and expect a root cause hypothesis with
    evidence.
- **Analyze task trends:** the workflow exists, but the skill `Analyze Task Trends` is **off**. Turn it on with
  role `platform_ai_analyze_trnds` for B7.
- **Identify ways to improve service** (Survey Analysis): active. F2 covers it.
- **Propose survey responses:** see the switch-off list.

---

## Plumbing (one line each)

| Capability | Note |
|---|---|
| Build task context from related tables; End user action description generator; Remedial action consent classifier (off) | Support the endpoint SME agents and `Trigger remedial action` subflows (A5 / P4-4) |
| GAF ITSM action mapper, reducer, strategy, grouping, hierarchical POV; Insights Clustering (`sn_icu`) | Clustering engine behind insights; keep active, not user-facing |
| Agent Activity POV, Playbook Generation, Intent Label Creation (`sn_icu`) | Agent activity mining for playbooks; leave it alone |
| NACM variants (incident, request, RITM, catalog task, resolution note, summarize and plan) | Now Mobile Agent versions; test only if mobile is in scope |
| `Form Autocomplete` (`sn_now_record_form`, active, not in product) | Generic form fill; Catalog slot fill is the better fit |
| Get New Skill Details, Get Child Record details | Internal tool skills |
| Moveworks skills (Ticket action, Write email, Search, Translate) | Only with the Moveworks chat integration (`sn_ex_mw_chat_int`); not the everis2 story |

---

## Ranked top 15 (value ÷ effort)

| # | Capability | Value | Effort | Why now |
|---|---|---|---|---|
| 1 | Investigate and recommend incident resolution (already triggered) | High | Low | Live since 9 Oct; fix the base-plan agent name, add Spanish KB, demo it |
| 2 | Major incident email content recommendation | High | Low | One toggle (in product) plus one communication plan; strong major incident moment |
| 3 | Triage and categorize, category step only (AIT trigger, P3 to P5) | High | Low | Trigger exists; category works without CMDB data |
| 4 | Request Status Agent in VA (plus retiring legacy topics) | High | Low | Active, a custom copy exists, top employee intent |
| 5 | Create Incident AI Agent plus generic-ticket fallback | High | Low | Two empty properties and topic clean-up |
| 6 | Wrap-up and resolve incident (panel, then trigger) | High | Low to Med | Closes the loop: notes, KB draft, known error |
| 7 | Generate my work plan (roles) | Med | Low | Already the most used ITSM workflow (80 runs) |
| 8 | Approval Assistance Agent | Med | Low | One config flag plus 3 policy articles |
| 9 | Attachment summarization for new incidents | Med | Low | One inactive business rule; config already active |
| 10 | Explain SLA | Med | Low | SLAs exist; tidy the duplicate definitions |
| 11 | Find catalog item agent in the AIT triage ("wrong door") | Med | Low | Agent exists; needs catalog curation (shared with #12) |
| 12 | Catalog Agent conversational ordering | High | Med | Curate 20 items and translate names |
| 13 | Proactive escalation on a schedule | High | Med | Needs sentiment backfill, policy article, schedule |
| 14 | Work Allocator for one group | High | Med | Roles, analyst languages and skills, approval step |
| 15 | Generate post incident reviews | Med | Low | Publish the draft flow, activate the AIT trigger |

Next in line: catalog form slot fill (Med/Low), Sidebar summarization (Med/Low), image to task (Med/Low), chat
summarization and reply (Med/Med, needs a chat queue), Intent to Action (High/High).

## Switch off or ignore (noise)

- **Propose survey responses** (survey filling trigger on `asmt_assessment_instance` for incident and RITM, inactive).
  An AI that proposes the requester's own satisfaction answers devalues CSAT. Keep it off.
- **Suggested steps generation** and the 4 **GAF Suggested Steps ITSM** skills (all off, superseded by Generate
  Resolution Plan), plus `[DEPRECATED] Incident assist`. Leave them off.
- **Legacy agents with no channel:** `Link incident to problem AI agent`, `Link major incident AI agent` (both
  replaced by "Link major incident or problem") and `ITSM incident resolution investigation AI agent` (replaced by
  the "plan" version; only the stale base plan still names it).
- **Identify Tasks from Email** (state 0, created by `karthik.veenam@snc`): an unfinished developer artifact.
- **Email Insight**: SPM, not ITSM. **Email Predictive Text Assistance**: low value and off.
- **Deflection Query Rephrase**: off; turn it on only if deflection search quality is poor.
- **Overlapping VA topics:**
  - inactive `sn_itsm_va` "(Template)" topics;
  - the active legacy RITM and approval topics once the agents take over;
  - jcolommo's Spanish NLU keyword topics.
  Remove them to avoid routing conflicts with LLM discovery (inferred).
- **Classify tasks and Issue readiness on incident:** keep one classifier (the Triage workflow) to avoid two agents
  writing the same fields.
- **Catalog item generation:** not installed; drop it from the plan.

## New use cases not yet in the strategy repo

1. **Attachment-aware intake.** Summarize screenshots, logs and PDFs on new incidents into a work note (business
   rule `Attachment Summ for New Incident (ITSM)` plus `di_attachment_summarization_config`). It extends B1.
2. **Wrong-door tickets.** Find catalog item AI agent inside the AIT triage: incidents that are requests get the
   item link and are closed as wrong channel. KPI: share of incidents reclassified.
3. **Requester ticket page summary.** Standard ticket page summarization in Employee Center, which cuts "any update?"
   comments. It extends A4.
4. **Chat actions without topics.** Conversational subflows and actions (`sn_conv_fa`) expose AIT Global subflows
   (group add, access extension) as chat skills. It sits between A3 and A5.
5. **Client onboarding accelerators.** Industry Category Recommender plus Incident Category Configuration agent,
   and Incident Routing Rule Recommender plus Incident routing configuration agent, propose category trees and
   assignment rules from 6 months of history. This is for delivery, and it ties to the ITSM accelerator packs.
6. **VA gap finder.** Interaction cluster summary and the GAF Interaction dashboard, fed by `Summarize VA chats on
   closure`, show which employee intents VA fails to deflect. This becomes the backlog for new topics, catalog items
   and KB articles.
7. **Requester-safe "when will it be done?".** Explain SLA added as a tool to the Request Status Agent copy, for
   employees (read-only, L4).
