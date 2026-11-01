# 20 - IT operations, AIOps and reliability (everis2, 2026-10-28)

Scope: Event Management and Alert Assist (`sn_alert_gen_ai`, `sn_em*`), AIOps agents (`sn_aiops_ai_agents`),
observability agents (`sn_obs_aia`), LEAP (`sn_itom_leap`), Error Framework (`sn_ef_gen_ai`), Discovery and MID
(`sn_discovery_ai_ag`, `sn_itom_mid_grdn`), Service Mapping agents (`sn_sm_gen_ai`), SLO and synthetic agents
(`sn_ai_agents_slo`, `sn_ai_agent_syn`), Health Log Analytics, on-call and major incident.

Paths below are relative to the mirror root
`metadata/` unless they say otherwise.

---

## 0. What generates the ITOM usage (the most-used domain on everis2)

Usage from `usage.md` (180 days) that belongs to this domain:

| LLM capability | Calls | Where it comes from |
|---|---|---|
| EM Alert Investigation | 167 | Step of the autonomous alert chain (past incidents for the alert) |
| EM Alert Analysis | 78 | Step of the chain, plus on-demand "Alert analysis" in SOW |
| Triage and investigate alerts | 76 | The "Autonomous chain" capability tool of *Manage alerts AI agent* |
| Alert Investigation Insight | 66 | Step of the chain |
| Summarize alert AI insights | 65 | Final summary written to the alert |
| Autonomous Styled Output | 64 | HTML rendering of the insight (`sn_alert_gen_ai.autonomous_workflow.html_rendering_enabled`) |
| Hierarchical capability (POV) | 359 | `sn_gaf` capability used by the **LEAP Hierarchical POV** skill (inferred: LEAP analysis runs) |
| Group capability (Topic) | 31 | `sn_gaf` capability used by **LEAP Topic Generation** (inferred: same LEAP runs) |
| Proactive grouping evaluation | 5 | Scheduled job "Event Management - Run Proactive Analysis" |
| KB Summarization Skill | 7 | Alert Assist KB step (`sn_alert_gen_ai`) |
| Agentic: Manage alerts autonomously | 82 executions | Alert Management Rule "Autonomous Workflow" |
| Agentic: Error Analysis and Remediation Workflow | 2 | Manual (Now Assist panel) |
| Agentic: Create alert automation | 1 | Manual |
| Agentic: LEAP agent | 1 | Manual |

**The mechanism.** Nothing in `sn_aia_trigger_configuration` fires for ITOM (all six trigger configurations on the
instance are `active: false`). The 82 executions come from an **Alert Management Rule**, not an AI Agent trigger:

- `sn_aiops_ai_agents/em_alert_management_rule/autonomous-workflow--f575aac02fb8b21083d0942bcfa4e302.yaml`:
  "Autonomous Workflow", `active: true`, filter
  `correlation_group=0^ORcorrelation_group=1^ORcorrelation_group=3^classification=0^state=Open^group_sourceNOT IN2,3,8^NQcorrelation_group=2^classification=0^state=Open^group_source=9^ORgroup_source=10`.
  That is **every open IT alert** (primary or uncorrelated), with no severity or source filter. `sys_mod_count: 40`,
  last edited 2026-03-30: someone has tuned it.
- Linked subflow `sn_aiops_ai_agents/em_alert_man_m2m_rule_flow/record--1485eac02fb8b21083d0942bcfa4e36a.yaml`,
  `execution: '1'` = automatic (the global "Create Incident Manually" rule uses `'2'`, so 2 = manual), `executions_limit: 1`.
- Subflow "Autonomous workflow" (`sn_aiops_ai_agents/sys_hub_flow/autonomous-workflow--d9976ac42fb8b21083d0942bcfa4e3a1.yaml`)
  -> action "Run Autonomous Workflow" -> `sn_aiops_ai_agents.EmAiaAlertAutonomousUtils.triggerAutonomousWorkflowForAlert()`.
- That starts use case "Manage alerts autonomously" (`90e6edc43b18b210ca36e79e53e45a81`) as the hard-coded user
  "AI OPS Agent" (`af192e203b736210f480be5aa5e45a12`, also `run_as_user` in
  `sn_aiops_ai_agents/sn_aia_usecase_config_override/record--cdc7e1883b18b210ca36e79e53e45aed.yaml`).
- The use case applicability script returns `false`
  (`sn_aiops_ai_agents/sn_aia_usecase/manage-alerts-autonomously--90e6edc43b18b210ca36e79e53e45a81.applicability_script.js`),
  so it is never offered in the Now Assist panel. It runs only from the rule.

**Where the alerts come from (inferred).** There are no configured observability connectors (the strategy repo records
"8 MCP connections without credentials"; no `sn_em_connector` instances are in the mirror). The user `malonsay` set up
Event Management on 2026-05-20 (EM wizard answers for connector, MID Server, remediation subflow, tag-based clustering,
and `ua_table_licensing_config` for `em_event0000..0006` are all his). The 82 runs over 180 days match
**demo events injected by hand or by a demo script** (inferred), not live monitoring. Each alert costs about six LLM
calls (the chain above), which is why this domain tops the usage table with so few executions.

**LEAP.** 359 POV calls and 31 topic calls against only one LEAP agent execution means LEAP **analysis runs**
(the LEAP workspace mining incidents into clusters; one POV per incident) generate most of the LLM traffic, not the agent.
The mapping is direct: `sn_itom_leap/sn_nowassist_skill_config/` "LEAP Hierarchical POV" has
`skill_id: f0622c97ff2122104a4effffffffff09` = `sn_gaf` "Hierarchical capability (POV)"; "LEAP Topic Generation" has
`skill_id: 266f0bef...` = "Group capability (Topic)". (`sn_icu` Insights Clustering and `sn_ai_list_exp` also use these
capabilities, so the attribution is inferred.) Both default to GPT Small (Azure OpenAI).

---

## 1. Licences and plugins: what is inactive and what it blocks

From `operational/plugins.yaml`:

| Plugin | State | What it blocks (inferred unless stated) |
|---|---|---|
| `com.snc.itom.op_entv2.license` ITOM Operator Enterprise v2 License | inactive | Entitlement for the AIOps "enterprise" bundle: Health Log Analytics, Metric Intelligence, advanced alert analytics. EM core and the AIOps agents still run (82 executions prove it), so it does not block Alert Assist. |
| `com.snc.itom.discovery.license` ITOM Discovery License | inactive | Discovery entitlement; no `com.snc.discovery` plugin appears in the list. Discovery schedules are inactive (strategy baseline). Blocks real CI data for Pattern Diagnostic and MID agents. |
| `com.sn_itom_opt_licensing` ITOM Optimization Licensing | inactive | Cloud cost / optimization features. Not needed here. |
| `com.snc.pa.premium.itom`, `com.snc.sa.metric.pa.content`, `com.snc.pa.discovery`, `com.snc.pa.cmdb` | inactive | ITOM, Operational Intelligence, Discovery and CMDB PA content: no trend dashboards for AIOps value KPIs. |
| `com.snc.clotho` MetricBase | inactive | Metric Intelligence and metric anomaly alerts (stated: anomaly properties like `sn_em_ai.evt_mgmt.TimeRangeForAnomalyMetricsInHours` exist but have no data source). |
| `com.snc.agent.distributed.cluster` MID Server Distributed Cluster | inactive | MID load balancing; irrelevant for a demo. |
| `com.snc.cmdb.csdm.activation` CSDM Activation | inactive | CSDM views and guided activation; weakens service-impact analysis. |
| `com.snc.uib.sow_srm_common` (Service Reliability Management) | **not installed** | **Stated:** the SLO scheduler job exits with "SRM plugin not enabled" (`sn_ai_agents_slo/sysauto_script/ai-agent-for-slos-job-scheduler--8cbef543d14a4cacb0d4f5b7d28baa80.script.js`). SLO agents can never be queued. |
| Health Log Analytics core | not installed | `sn_hla_ai` "AI Agents for Health Log Analytics" 1.1.1 and `sn_sow_hla` are installed (`store_apps.yaml`) but no HLA agent or skill appears in the mirror or `agents.txt`. Nothing to configure. |

Active and relevant: `com.snc.service-watch` (EM and Service Mapping core), `com.snc.service-mapping`,
`com.glideapp.agent` (MID Server), `com.snc.on_call_rotation`, `com.snc.incident.mim.ml_solution` (PI for major incident),
store apps `sn_aiops_ai_agents` 1.11.3, `sn_alert_gen_ai` 3.11.3, `sn_obs_aia` 6.2.3, `sn_itom_leap` 4.2.1,
`sn_ai_agents_slo` 2.1.2, `sn_discovery_ai_ag` 3.2.1, `sn_itom_mid_grdn` 1.0.4, `sn_sm_gen_ai` 1.4.1.
Installed but absent from the mirror (cannot assess): `sn_hla_ai`, `sn_itom_gen_ai`, `sn_aia_acc`, `sn_sow_aiops`,
`sn_ds_ai_agents`.

---

## 2. Capabilities

### Manage alerts autonomously (autonomous alert triage and investigation)
- **Kind / where:** agentic workflow (`sn_aiops_ai_agents`), agent *Manage alerts AI agent* with tools "Autonomous chain"
  (capability = *Triage and investigate alerts*) and "Update Alert AI Insights and Worknotes". Surface: Alert Management
  Rule trigger; output in the SOW alert record (AI insights) and alert work notes.
- **State on everis2:** active; 82 executions; skills on Azure OpenAI (all `default=true` definitions are Azure OpenAI).
  Runs as "AI OPS Agent". Writes `em_gai` (status, HTML insight) and `sn_aiops_alert_ai_insight`
  (columns `triage`, `impact`, `investigation`, `observability`, `summarization`). Properties: `sn_aiops_ai_agents.avg_time_saved_by_ai_analyzed_in_min=15`,
  `..._resolved_in_min=5` (used by AIOps dashboards). Watchdog job "EM GAI Processing Timeout Watchdog" every 5 min.
- **Persona and business problem:** NOC operator / L2 on shift. Every alert needs a first look: what is it, what is
  affected, has it happened before, who should take it. Constant volume; at a client hundreds to thousands per day.
- **Business logic to enable it:** trigger = new open primary IT alert (rule above). Inputs: alert, CI, CMDB group,
  past incidents on the CI, related changes, KB. Outputs: overview, what is affected, probable cause, who should look,
  next step, historical pattern (titles in `EmAiaAlertAutonomousUtils`). Writes work notes and insight records; may
  **close the alert as noise** (see next capability) and may reassign to the previous operator
  (`sn_aiops_ai_agents.reassign_enabled`, default true). Human checkpoint: operator reads the insight before acting.
  Current level L3 (triggered, read-mostly), target L3 for incident creation, L4 for enrichment only.
- **Tweaks to make it useful:**
  - Narrow the rule filter: add `severity<=3` (critical, major, minor) and exclude maintenance; today warnings and
    info alerts also spend six LLM calls each.
  - Data: alerts must carry `cmdb_ci`, and CIs must belong to services (CMDB groups or service maps). 393/430 open
    incidents have no CI, so *EM Alert Investigation* (past incidents per CI) returns little. Seed 20 to 30 resolved
    incidents with CI and good resolution notes for the demo CIs.
  - Language: section titles use `gs.getMessage(...)` ("Probable cause:", "Next-best actions:"), so add Spanish
    `sys_ui_message` entries; the LLM text follows the run-as user, which is "AI OPS Agent": set that user's
    preferred language to the operators' language.
  - Set `sn_alert_gen_ai.save_alert_summarization_to_worknotes` explicitly (now absent) so the behaviour is visible.
  - Keep `sn_alert_gen_ai.alert_assist_request_max_words=1840`; raise only if summaries truncate.
  - Copy for client builds: copy the subflow as `AIT - Autonomous alert triage` and the rule as `AIT Autonomous Workflow`
    in Global; keep OOB rule inactive to avoid double runs.
- **Validation test:** in SOW, Event Management > Events > New (or `em_event.do`): source `Demo`, node = a server CI
  that has a service, type `CPU`, resource `cpu0`, severity Critical, description "CPU 98% for 10 min on payroll DB".
  Wait for alert creation (about 1 min). Open the alert in SOW > Alerts: the "AI insights" area shows overview,
  affected service, probable cause, next step; work notes have the summary; `sn_aiops_alert_ai_insight` has a row for
  the alert; `sn_aia_execution_plan` has a new "Manage alerts autonomously" plan.
- **Value / effort:** High / Low. Already running; the work is filter, data and language.

### Alert noise auto-close (Alert noise handler)
- **Kind / where:** skill inside the autonomous chain (`sn_alert_gen_ai` "Alert noise handler", Azure OpenAI) plus
  script `EmAiaAlertAutonomousTriageUtils` that sets the alert to `Closed`.
- **State on everis2:** live by default. `_resolveAutoCloseInsignificantEnabled` reads
  `sn_aiops_ai_agents.autonomous_close_insignificant_alert` with default `'true'`; the property does not exist on the
  instance (not in `props.txt`), so **the agent closes alerts it judges insignificant without approval**
  (`sn_aiops_ai_agents/sys_script_include/emaiaalertautonomoustriageutils--a5f62b7a2b73a2105dc1f38f5e91bf75.script.js`, lines 340-375).
  Noise detection needs history: `sn_alert_gen_ai.min_alerts_for_noise` default 20.
- **Persona and business problem:** NOC lead drowning in flapping and informational alerts.
- **Business logic to enable it:** condition = alert classified `is_not_significant` with enough history. Output:
  `closure_reason = closed by AI` in `em_gai.additional_info`, alert closed, insight flag `alert_closed`. If an operator
  reopens, `sn_aiops_ai_agents.full_flow_on_insignificant_user_reopen` (default true) reruns the full flow.
  Target L4 only for low-severity sources after a review period; L3 (suggest, do not close) elsewhere.
- **Tweaks:** create the property explicitly and decide: `false` during demos with real-looking critical alerts, `true`
  for a "noise reduction" demo. Add a report on alerts with `closure_reason=closed by AI` for audit. Consider
  `sn_aiops_ai_agents.clear_assignment_for_noise_alerts=true`.
- **Validation test:** create the same low-severity event (severity Warning, same node and type) 25 times over a few
  minutes (or reuse an alert with history); the 25th alert ends Closed with work note "Alert auto-closed as
  insignificant" and the insight shows the reason.
- **Value / effort:** High / Low. One property and one report; the governance decision is the real work.

### Alert Assist on demand in SOW (Alert analysis, investigation, related changes, impact, hypotheses)
- **Kind / where:** skills in `sn_alert_gen_ai` shown in SOW alert record and Now Assist panel; VA/NAP topics
  "Perform Alert Analysis" and "Analyze related incidents" (`sn_alert_gen_ai/sys_cs_topic`).
- **State on everis2:** 13 skills active and in product (`skills.txt`): AI Investigation report for alert, Alert
  Hypothesizer, Alert Investigation Insight, Alert Remediation Subflow Ranking, Alert impact analysis, Alert
  investigation, Alert noise handler, KB Summarization, Proactive grouping evaluation, Related Changes Analysis,
  Summarize alert AI insights, Triage and investigate alerts; Autonomous Styled Output active, not in product.
  `evt_mgmt.enable_mg_alert_assist=true`. Roles empty (anyone with SOW alert access).
- **Persona and business problem:** L2 engineer investigating an alert that the autonomous run did not settle; wants
  "what changed" and "what does the KB say" without opening five lists.
- **Business logic to enable it:** on-demand button / panel prompt on an alert. Read-only. L1-L2.
- **Tweaks:** Related Changes Analysis depends on changes with CIs (279/360 open changes have none): add CIs to 10
  demo changes on the alert CIs, set `sn_alert_gen_ai.related_changes_window_days` (absent, default) to 7. KB step:
  publish 5 KB articles about the demo CI types (none in Spanish today).
- **Validation test:** open the alert from the previous test in SOW > Now Assist panel > "Analyze related changes"
  (or click the Alert Assist "Investigate" action); expected: list of changes on the CI in the window with a risk
  statement, and a KB summary.
- **Value / effort:** Medium / Low.

### Create Incident with AI Insight
- **Kind / where:** Alert Management Rule + subflow (`sn_alert_gen_ai/em_alert_management_rule/create-incident-with-ai-insight--2518602d87ea8a500f1287780cbb35c7.yaml`,
  subflow "Create Incident with AI Insight"). Quick action in SOW alert.
- **State on everis2:** rule active, but the flow link is `execution: '2'` (manual). Filter: no incident, not in
  maintenance, `group_source IN 2,3,4,5,6,9,10,11,12,13`, state Open/Reopen/Flapping.
  `sn_alert_gen_ai.alert_analysis_on_new_incident_enabled` absent (default true).
- **Persona and business problem:** operator who must open an incident from an alert and copy the analysis by hand.
- **Business logic to enable it:** for critical alerts on production CIs, run automatically after the autonomous
  insight; the incident gets short description, description, CI, service, assignment group from the analysis.
  Target L3 (automatic for severity 1, manual button for the rest).
- **Tweaks:** add a second link with `execution: 1` filtered to `severity=1` (copy as `AIT Create Incident with AI Insight`);
  map assignment group from CI support group; make sure the incident triggers *Triage and categorize ITSM incidents*
  once that trigger is enabled (journey B).
- **Validation test:** on a Critical alert without incident, SOW > alert > Quick actions > "Create Incident with AI
  Insight"; expected: new incident linked to the alert with AI-written description and CI.
- **Value / effort:** High / Low.

### Proactive alert grouping
- **Kind / where:** scheduled engine plus skill "Proactive grouping evaluation" (Azure OpenAI) in `sn_alert_gen_ai`;
  suggests grouping rules.
- **State on everis2:** job "Event Management - Run Proactive Analysis" active every 5 minutes; "Proactive Grouping
  Orchestrator" and Workers 1-4 **inactive** (`sn_alert_gen_ai/sysauto_script/`). 5 LLM calls in 180 days.
  `evt_mgmt.proactive_grouping_enabled` default true.
- **Persona and business problem:** event manager who maintains correlation rules by hand.
- **Business logic:** periodically scan alert history, propose groups with a rationale; admin accepts as rule. L2.
- **Tweaks:** needs alert history (hundreds of alerts); on a demo, load a historical alert set first. Either activate
  orchestrator and workers or deactivate the 5-minute job (it runs for nothing).
- **Validation test:** SOW > Alert automation (Configuration console) > Grouping suggestions: after loading history
  and one orchestrator run, at least one suggestion with an AI rationale appears.
- **Value / effort:** Medium / Medium (needs data).

### Create alert automation (Alert Automation AI Agent)
- **Kind / where:** agentic workflow `sn_aiops_ai_agents` "Create alert automation", copilot, Now Assist panel in SOW
  config console. Tools create, activate and delete alert grouping automations.
- **State on everis2:** active; 1 execution.
- **Persona:** event management admin. "Group all disk alerts from the same host within 10 minutes."
- **Business logic:** natural-language request -> canonical grouping rule -> created inactive -> admin activates. L2.
- **Tweaks:** none functional; add a demo script of three prompts. Restrict to `evt_mgmt_admin` in
  `sys_agent_access_role_configuration` if not already.
- **Validation test:** SOW > Now Assist panel: "Create an automation that groups alerts with the same node and
  metric within 15 minutes"; expected: link to a new grouping automation record in draft.
- **Value / effort:** Medium / Low.

### AI Worker mode for alerts
- **Kind / where:** subflow "Trigger AI worker autonomously" (`sn_aiops_ai_agents/sys_hub_flow/trigger-ai-worker-autonomously--3300f0b32baff210da29ffbaf291bf36.yaml`)
  with `EmAIAWorkerUtil`: assigns the alert to an AI worker, avoids duplicate runs, supports "Manual Trigger" rules.
- **State on everis2:** `sn_aia.enable_ai_workers=true`; subflow published but **no alert rule links to it**. The live
  path is the older "Autonomous workflow" subflow.
- **Persona:** NOC lead who wants the AI to appear as a team member with a queue and metrics.
- **Business logic:** rule -> AI worker assigned (`assigned_to` = worker) -> runs triage/impact/investigation ->
  hands back to the previous assignee. L3.
- **Tweaks:** create `AIT Autonomous Workflow (AI worker)` rule linking this subflow and deactivate the old link;
  verify `sn_aiops_ai_agents.ai_insights.ai_worker.max_assignment_groups`. (inferred: this is the product direction.)
- **Validation test:** create a critical event; the alert shows Assigned to = AI worker while processing, then the
  previous operator; insight present.
- **Value / effort:** Medium / Medium.

### Alert remediation subflows (with ranking)
- **Kind / where:** EM remediation subflows (`sn_em_alert_mgmt_c`, `sn_em_connector`) and skill "Alert Remediation
  Subflow Ranking"; property `sn_aiops_ai_agents.remediation_agent.exclude.alert_rules_ids_list`.
- **State on everis2:** rules "Linux server actions" and "Windows server actions" **inactive**; their 14 subflow
  links are manual. Needs a MID Server with credentials to run anything on hosts.
- **Persona:** L2 who restarts a service or clears a disk for the 50th time.
- **Business logic:** alert -> ranked remediation options -> operator approves -> subflow runs on MID -> verify alert
  clears. L3; L4 only for a decision table of safe fixes.
- **Tweaks:** activate one rule for one CI class; add an approval step in the copied subflow (`AIT - Restart service`);
  for demos without MID, point the subflow at a simulated action that writes a work note.
- **Validation test:** alert on a Linux server CI > Quick actions > the remediation list ranked by the AI; run "Restart
  service" (simulated); work note records the action.
- **Value / effort:** High / Medium (MID or simulation).

### Analyze alert impact (SRE Investigate) and the observability vendor agents
- **Kind / where:** use case `sn_obs_aia` "Analyze alert impact" -> *SRE Investigate AI Agent* orchestrating 15
  vendor agents (Dynatrace, Datadog, New Relic, Splunk, ThousandEyes, AWS CloudWatch, Azure Monitor, Gemini Cloud
  Assist A2A, LogicMonitor, Prometheus, Kentik, SolarWinds, Network SME). Five Observability Skills (Datadog,
  Dynatrace, Gemini, Kentik, New Relic) active and in product. Impact agents in `sn_aiops_ai_agents`: Alert Impact
  Verification, Business And Technology Management Service Impact, Service instance impact, User impact.
- **State on everis2:** all active, 0 executions. Seven MCP servers defined (`sn_obs_aia/sn_mcp_server/`) with
  connection aliases, no credentials (strategy repo). `sn_obs_aia.pre_eval.alert_volume_threshold=100`.
- **Persona:** SRE on a P1: "is it the app, the network or the cloud?" across tools.
- **Business logic:** on P1/P2 alert or on request, query the monitoring tool for the entity, correlate, write an
  observability section into the alert insight (`observability` column). L2-L3, read-only.
- **Tweaks:** pick **one** vendor with a free tenant (Dynatrace or New Relic trial; Prometheus API is the cheapest
  self-hosted option), fill the connection alias credentials, and send its events through the matching EM connector so
  `source` matches. Impact agents need CI -> service relations and `sn_aiops_ai_agents.max_num_*` limits are fine.
- **Validation test:** with one vendor connected, open an alert from that source in SOW > Now Assist panel > "Analyze
  the impact of this alert"; expected: impacted services, users and vendor findings (metrics, logs) in the panel and
  the alert insight.
- **Value / effort:** High / High (external tenant and credentials).

### SRE pre-engagement readiness check (hidden helper)
- **Kind / where:** script include `SREPreEngagementEval` (`sn_obs_aia/sys_script_include/srepreengagementeval--1c46a425c2641e0ee701692b4fd48562.script.js`):
  checks EM sources, alert volume per source (>=100 eligible alerts), connection alias status and platform stats;
  produces PASS/WARN/FAIL as JSON or HTML.
- **State on everis2:** present, not wired to UI.
- **Persona:** NTT consultant scoping AIOps at a client.
- **Business logic:** run once per client instance to show which AIOps agents can work with their data. L0.
- **Tweaks:** wrap in a Global fix script or a scripted REST call in a sub-prod (never production writes; it is read-only).
- **Validation test:** Scripts - Background on everis2 (admin): `gs.info(new sn_obs_aia.SREPreEngagementEval().toJson(new sn_obs_aia.SREPreEngagementEval().evaluate({})))`
  (inferred signature); expect FAIL on alert volume and alias status.
- **Value / effort:** Medium / Low (pre-sales asset).

### LEAP (automation opportunities from incident history)
- **Kind / where:** LEAP workspace (`sn_itom_leap`, UIB app with 58 screens) runs analyses that cluster incidents
  (skills LEAP Grouping, Hierarchical POV, Topic Generation, Action Mapper/Reducer/Strategy, Outcome Enhancer/Filter,
  KB Generator). Agentic: "LEAP agent" use case (Artifact creation agent: creates Problem, KB, playbook), plus agents
  LEAP KB Creation, LEAP Problem Creation, LEAP Ansible (discovery) and LEAP Ansible Execution (MCP to Ansible
  Automation Platform; launch tools are `copilot` = need approval).
- **State on everis2:** POV and Topic capabilities used 359 and 31 times (inferred LEAP analyses); LEAP agent 1
  execution. LEAP KB Generator, Outcome Enhancer, Outcome Filter active, not in product. Daily jobs "Update Record
  Metrics Table with Calculated Metrics" active. "LEAP Ansible MCP" server defined, no back-end (strategy: `MISSING`).
- **Persona and business problem:** problem manager / automation lead: "which repetitive incidents should we
  automate or fix at the root?" Monthly to quarterly review.
- **Business logic to enable it:** schedule a LEAP analysis on resolved incidents of the last 90 days per service
  area; review clusters; from a cluster, the agent drafts a Problem (with incidents linked) and a KB from the
  resolution steps; a manager validates. Ansible execution only with approval. Target L2 for analysis, L3 for
  artifacts.
- **Tweaks:** LEAP quality depends on resolution notes and categories: the ITSM accelerator incident data should be
  used as the corpus. Make KB output Spanish by running as a Spanish-preference user. Put LEAP KB Generator in
  product so the drafts show in the LEAP workspace. Keep Ansible tools at copilot.
- **Validation test:** LEAP workspace > New analysis on incidents (last 180 days, category Software) > wait for
  completion > open the top cluster > "Create problem" via the LEAP agent panel; expected: a draft Problem record
  listing the clustered incidents and a draft KB from the resolution steps.
- **Value / effort:** High / Medium (good incident history needed).

### Error Analysis and Remediation Workflow (Error Framework)
- **Kind / where:** agentic workflow `sn_ef_gen_ai`, copilot, Now Assist panel on Error Framework pages; tools read
  error codes (for example `SN-DISC-1561`), list errors, run pre-configured remediation actions, knowledge graph schema.
  Also a member of the Discovery "Pattern Diagnostic Workflow".
- **State on everis2:** active; 2 executions.
- **Persona:** ITOM / platform admin facing integration and discovery errors.
- **Business logic:** on request, explain an error code, group occurrences, propose and (with confirmation) run the
  configured remediation. L2, L3 for remediation.
- **Tweaks:** none functional; it needs Error Framework records, which Discovery and integrations create. Add to the
  admin demo script.
- **Validation test:** Now Assist panel as admin: "What are the most frequent open Error Framework errors this week and
  how do I fix the top one?"; expected: list by error code with root cause and a remediation offer.
- **Value / effort:** Medium / Low.

### Pattern Diagnostic Workflow (Discovery and CMDB data quality)
- **Kind / where:** `sn_discovery_ai_ag` use case, copilot; Pattern Diagnostic Agent (resolve CI class, pattern lookup,
  missing-data detector, discovery log parser, error classifier) + Error Analysis and Remediation Agent.
- **State on everis2:** active, 0 executions. Discovery licence inactive, schedules inactive; CMDB Health jobs
  (completeness, compliance, correctness, relationships) active daily.
- **Persona:** CMDB manager: "why are 300 Linux servers missing OS version?"
- **Business logic:** for a CI class, find CIs with missing attributes, map to the pattern that should populate them,
  parse discovery logs, hand errors to remediation. L2.
- **Tweaks:** needs Discovery runs (MID + credentials) to have logs; without them it can only report missing
  attributes. Pair with the CMDB Health dashboard (`sn_getwell`).
- **Validation test:** Now Assist panel: "Which Linux servers are missing data that discovery should fill, and why?";
  expected: class resolved to `cmdb_ci_linux_server`, list of missing attributes with counts, pattern names.
- **Value / effort:** Medium / Medium (High at clients with Discovery).

### MID Guardian Workflow
- **Kind / where:** `sn_itom_mid_grdn` use case with MID upgrade, network, keystore and common agents; VA topics "MID
  Guardian", "MID Server Guardian", "MID Guardian Invoker"; global topics "Discovery & MID Server Health Validation" and
  "Discovery Performance Metrics" (by `now.itom_cre`). Tools run log analysis on the MID and web search on
  `support.servicenow.com` and docs.
- **State on everis2:** active, 0 executions; MID Server presence not confirmed (strategy baseline).
- **Persona:** ITOM admin with a MID down or failing upgrade.
- **Business logic:** diagnose MID issues, fetch top errors, guide or run rekey/validation. L2, L3 for rekey.
- **Tweaks:** install one MID Server on a VM for demo (also needed by remediation and discovery).
- **Validation test:** Now Assist panel: "My MID server <name> is down, help me"; expected: details fetched, top errors,
  steps.
- **Value / effort:** Medium / Medium.

### Service Mapping AI (Service Map Creation, Tag-based maps, Business App inference, Analyze Potential Impact)
- **Kind / where:** `sn_sm_gen_ai` agents and skills (Business App Inference, Business App Similarity active and in
  product; Service Mapping Candidate skills no status). Use case "Analyze Potential Impact" (change).
- **State on everis2:** 2 of 4 agent configs inactive (Service Map Creation and the custom CSDM Business Application
  agent show `f` in `agents.txt`); 0 executions. Needs `svc_by_tags_candidates` and running process data (Discovery).
- **Persona:** service owner / CMDB manager building application services.
- **Business logic:** propose application services from candidates; persist topology; suggest business application.
  L2 with approval before persisting.
- **Tweaks:** without Discovery data only Business App Inference is demonstrable. Low priority on everis2.
- **Validation test:** CMDB Workspace > Application service candidates (if any) > "Create service map"; expected: draft
  service with CIs.
- **Value / effort:** Medium / High.

### SLO and synthetic monitoring agents (Reliability Domain, SLO Gap, SLO Creator, Generate Reliability Plan, Synthetic Creator)
- **Kind / where:** `sn_ai_agents_slo`, `sn_ai_agent_syn`; scheduled (job scheduler biweekly, runner every 5 min),
  subflow "Trigger SLO Creator Agent".
- **State on everis2:** agents active; `sn_ai_agents_slo.enable_slo_agent=true`, email properties on; `create_slo_mode`
  absent = default **`auto_activate`**. The scheduler returns immediately because `com.snc.uib.sow_srm_common` is not
  installed. The runner job polls an empty queue every 5 minutes. 0 usage.
- **Persona:** SRE / service owner after a P1: "do we even have an SLO and a synthetic check for this?"
- **Business logic:** after P1/P2 incidents, detect SLO and synthetic gaps, create SLO/SLI and reliability tasks.
  L3 with SLOs created in draft.
- **Tweaks:** blocked by the missing SRM app (and synthetic monitoring app). If installed: set
  `sn_ai_agents_slo.create_slo_mode=draft`. Otherwise deactivate the runner job.
- **Validation test:** not runnable on everis2 today. After SRM install: resolve a P1 on a service CI, wait for the
  scheduler, check `sn_ai_agents_slo_creator_agent_queue` and a draft SLO.
- **Value / effort:** High / High.

### Health Log Analytics agents
- **State:** `sn_hla_ai` installed, nothing in the mirror, HLA core and Operator Enterprise licence missing. Not
  usable. **Value / effort:** Medium / High. Ignore on everis2.

### On-call: Who is On Call and Manage On Call Shifts
- **Kind / where:** `sn_itsm_aia` use cases "Who is On Call" (On Call Retrieval, read-only) and "Manage On Call Shifts"
  (On Call Shift Creator); topic "Incident Assist - On-call Experts"; On-Call Scheduling plugin active; on-call subflows
  active (assign, escalate by email/SMS/voice); `sn_on_call_m_notif` installed.
- **State on everis2:** active, 0 executions. Rota data not verified (inferred: few or none). SMTP outbound is off, so
  escalation notifications do not leave the instance.
- **Persona:** service desk agent or incident manager at 02:00: "who is on call for Database tonight?"
- **Business logic:** read-only lookup from panel or VA; shift creation guided by the agent with manager confirmation.
  L2. Link into the alert path: the autonomous insight's "Who should look into it" should name the on-call person.
- **Tweaks:** create rotas for 3 to 4 demo groups (Network, Database, Service Desk, Hardware) with members across
  time zones; check `cmn_rota` before demos. Language: natural-language times ("tonight") in Spanish need testing.
- **Validation test:** SOW > Now Assist panel: "Who is on call for Database tonight?"; expected: name, shift, escalation
  order. Then "Create a weekly rotation for Network with Ana and Luis"; expected: draft shift after confirmation.
- **Value / effort:** Medium / Low.

### Major incident: link to MI or problem, post incident review, MI email content
- **Kind / where:** *Link major incident or problem AI Agent* (member of "Triage and categorize ITSM incidents"; can
  propose a new MI on a surge), use case "Generate post incident reviews" (Post incident review AI agent), skill
  "Major incident email content recommendation" (`sn_itsm_gen_ai`, active, not in product); PI for MIM active; EM rules
  "Create Major Incident" and "Create Major Incident Candidate" inactive (subflows edited by `salvarac` 2026-06-18).
- **State on everis2:** triggers "Triage and categorize ITSM incidents - on create" and "Generate post incident review
  on resolved" both inactive (`sn_itsm_aia/sn_aia_trigger_configuration/`). 0 usage.
- **Persona:** major incident manager: link 40 duplicate calls, write stakeholder updates, deliver the PIR in 48 h.
- **Business logic:** on new incident, propose link to an active MI; on surge of similar incidents, propose MI
  candidate (manager accepts); on MI resolved, generate PIR draft into the MI record (`run_as: assigned_to`). L3.
- **Tweaks:** activate the PIR trigger (condition already correct: state changes to 6 and `major_incident_state=accepted`);
  put MI email content recommendation in product for `major_incident_manager`; enable the EM rule "Create Major Incident
  Candidate" for alerts on business services (copy as AIT).
- **Validation test:** promote INC to major incident (SOW > Promote), add 3 child incidents, resolve the parent;
  expected: PIR text appears on the MI record within minutes and an `sn_aia_execution_plan` "Generate post incident
  reviews" row exists.
- **Value / effort:** High / Low (overlaps journey B and C in the ITSM file).

### Plumbing and minor items (one line each)
- *Autonomous Styled Output*: HTML renderer for the alert insight; keep, no tuning.
- *KB Summarization Skill* (alert): used by the chain; needs published KB.
- *Alert Hypothesizer*, *AI Investigation report for alert*: parts of the investigation; on by default; no extra work.
- *Related Changes Analysis Skill*: see Alert Assist; data dependent.
- *Run Service Analysis* subflow (`sn_alert_gen_ai`): service analysis on alerts; controlled by `sn_sow_svcobs.disable_service_analysis_in_alerts`.
- *Datadog / Dynatrace / Gemini / Kentik / New Relic Observability Skills*: only with a vendor connected.
- *Network SME, Prometheus, LogicMonitor, SolarWinds, Kentik agents*: children of SRE Investigate; same prerequisite.
- *Schedule event generator* (`sn_uxc_gen_ai`): calendar, not EM events; out of domain.

---

## 3. Ranked top 15 (value / effort)

| # | Capability | Value | Effort | Why now |
|---|---|---|---|---|
| 1 | Manage alerts autonomously: filter, CI data, Spanish | High | Low | Already the most-used AI on everis2; tuning makes it credible |
| 2 | Noise auto-close policy (property + audit report) | High | Low | It is already closing alerts by default; make it a deliberate, visible feature |
| 3 | Create Incident with AI Insight, automatic for severity 1 | High | Low | One rule link; closes the alert-to-incident loop for journey C |
| 4 | Post incident review trigger + MI email content | High | Low | Trigger exists with the right condition; activate it |
| 5 | Link major incident or problem (via triage trigger) | High | Low | Shared with journey B; MI surge detection is a strong demo |
| 6 | LEAP analysis -> Problem and KB drafts | High | Medium | Real usage already; needs incident corpus and manager validation |
| 7 | Who is On Call + on-call in the alert insight | Medium | Low | Needs rota data only |
| 8 | Create alert automation (agent) | Medium | Low | Works now; admin demo |
| 9 | Error Analysis and Remediation | Medium | Low | Works now; admin demo |
| 10 | Alert Assist on demand (related changes, KB) | Medium | Low | Needs CIs on changes and a few KB articles |
| 11 | SRE pre-engagement readiness check | Medium | Low | Pre-sales asset for clients |
| 12 | Alert remediation subflows with approval (simulated) | High | Medium | Completes C4; MID or simulation |
| 13 | AI Worker mode for alerts | Medium | Medium | Product direction; better operator UX |
| 14 | Proactive grouping (with loaded history) | Medium | Medium | Needs history; or switch the job off |
| 15 | SRE Investigate with one vendor (Dynatrace/New Relic trial) | High | High | Best "agentic AIOps" story; needs a tenant |

Below the line: MID Guardian (needs MID), Pattern Diagnostic (needs Discovery), Service Mapping AI, SLO and synthetic
agents (SRM app missing), HLA agents (core missing).

## 4. Switch off or ignore (noise)

- **SLO Agent Runner job** (`sn_ai_agents_slo/sysauto_script/ai-agent-for-slos-agent-runner--ba0ae4663de744df88f70e42ab3adfe6.yaml`):
  polls an empty queue every 5 minutes because SRM is missing. Deactivate until SRM is installed; set
  `sn_ai_agents_slo.create_slo_mode=draft` before reactivating.
- **"Event Management - Run Proactive Analysis"** every 5 minutes while orchestrator and workers are inactive: either
  activate all or deactivate it.
- **Autonomous Workflow rule on warnings and info alerts**: add a severity filter; it spends about six LLM calls per alert.
- **Two autonomous paths**: if AI Worker mode is adopted, keep only one rule linked, or alerts run twice
  (`executions_limit` is per link).
- **Ignore on everis2**: HLA agents, Synthetic Creator, SLO agents, 13 vendor observability agents except the one you
  connect, Service Map Creation, LEAP Ansible agents (no AAP back-end), Linux/Windows server action rules until MID exists.
- **Inactive OOB EM rules** "Create Incident", "Create Incident for Primary Alert", "Create Incident on Primary
  Critical Alert", "Create Major Incident": leave inactive; build AIT copies instead, so OOB and AI paths do not
  both create incidents.

## 5. New use cases not in the strategy repo

1. **Noise governance board (L4 with audit).** Weekly report of alerts closed by AI (`em_gai.additional_info.closure_reason`),
   reopen rate, and per-source auto-close switch (`EmAiaWorkerAutoCloseTaskConfigApi`). Makes the existing L4
   behaviour a sellable, governed feature. Not in journeys C or F.
2. **AIOps readiness assessment for clients** using `SREPreEngagementEval` (sources, alert volume >= 100 per source,
   alias status) plus the CMDB Health scores, as a first-week deliverable.
3. **AIOps value dashboard.** The properties `avg_time_saved_by_ai_analyzed_in_min=15` and `..._resolved_in_min=5`
   plus `sn_aiops_dashboard` already compute time saved; publish it as the adoption KPI the P1-1 gap G10 asks for
   (PA premium ITOM content is inactive, so use the `sn_aiops_dashboard` reports).
4. **Alert-to-on-call handoff.** Feed On Call Retrieval into the autonomous insight's "Who should look into it" and
   page that person when the alert is severity 1 (needs SMTP/SMS on; today SMTP outbound is off).
5. **LEAP-driven problem backlog review.** A monthly LEAP analysis per service area that opens Problem drafts with
   linked incidents, reviewed by the problem manager (strategy C6 mentions LEAP but not as a scheduled governance loop).
6. **Error Framework triage for platform health.** Use the Error Analysis workflow as the admin's daily check on
   integration and discovery errors (journey F-style platform operations, not in the strategy).
7. **MI candidate from alert surges.** Combine the EM rule "Create Major Incident Candidate" with the Link major
   incident agent's surge detection, so alerts and calls converge on one MI candidate.
