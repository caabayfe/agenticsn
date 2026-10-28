# everis2 baseline

Source: read-only snagentic mirror of `everisspainsludemo2.service-now.com`, pulled
2026-10-27 (825,475 records, 959 scopes). Release family: Zurich. "ServiceNow Otto" is the
new name of Now Assist.

## AI at a glance

| Area | What is there | What it means |
|---|---|---|
| AI agents | 159 agents, 147 enabled; 6 voice agents, all disabled | The catalogue is rich; we configure rather than build |
| Agentic workflows (use cases) | 48: 45 copilot, 1 autopilot ("Generate Resolution Plan"), 2 unset | Almost everything runs only when a person asks |
| Triggers | 1 autonomous ITSM trigger: "Investigate and recommend incident resolution" (added 2026-10-09) | L3 is barely started |
| AIOps | "Autonomous Workflow" alert rule active | One ITOM autonomous path exists |
| Tools | 856 agent tools, 99 of them MCP tools | Agents can already reach flows, subflows, scripts and MCP |
| MCP | MCP server app (`sn_mcp_server` 1.7.2), Universal MCP Client; a custom "Test MCP" server with 21 tools; 8 outbound observability MCP connections without visible credentials | External agents and tools can plug in once credentials are set |
| A2A | External Agent Management util pack; Gemini Cloud Assist A2A Investigation Agent | A2A works for at least one partner agent |
| Skills | 320 skill configurations, 254 active, 145 shown in product (ITSM 27, Alert Assist 13) | L1 is largely ready |
| LLM providers | Managed Azure OpenAI, Bedrock Claude and Gemini models active; Now LLM inactive | Model choice per skill is possible |
| Guardrails | Prompt injection guardian at MONITOR; GenAI security detectors off; all AI Control Tower approvals off | Must be tightened before any L3 or L4 demo |
| Virtual Agent | 414 topics (374 active), LLM topics, Now Assist in VA, "AIA - Agent invoker from VA" topic | Chat can already call agents |
| Language | Dynamic Translation, VA Language Detection and Translation, Azure Translator spoke, Language Detection spoke: active. UI translation packs: only Spanish | Multilingual chat works; UI is English and Spanish |
| Voice | `sn_voice_aia`, `sn_itsm_voice_aia` 2.0.3 installed; "AI Voice Agents Skill Config" inactive; no telephony integration found | Voice needs a telephony channel and activation |
| Predictive Intelligence | Incident and Major Incident solutions active; Change, Knowledge and Task Intelligence inactive | Classic ML can back up the LLM for triage |
| On-call | On-Call Scheduling active; On Call Retrieval and Shift Creator agents | On-call lookups work; notification channel to add |
| Moveworks | "ServiceNow Otto Chat Integration (built on Moveworks)" and its skills present | Optional employee chat front end |

## ITOM readiness

| Item | Status |
|---|---|
| Event Management and Service Mapping core | `ON` |
| AIOps agents, Alert Assist skills, Service Operations Workspace | `ON` |
| LEAP (automation opportunities, Ansible agents) | `ON`, Ansible back-end `MISSING` |
| Observability agents (LogicMonitor, Dynatrace, Splunk, Datadog, ...) | `ON`, connections and credentials to configure |
| MID Server | Not confirmed |
| Discovery schedules | Inactive |
| CSDM Activation, ITOM AIOps licence, ITOM Discovery licence plugins | `OFF` |
| Health Log Analytics, SLO and synthetic monitoring core apps | `MISSING` (the SLO and synthetic agents exist, their data apps do not) |
| Remediation subflows | Present, behind inactive alert rules |
| SSH and PowerShell action steps | `MISSING` |
| Microsoft Teams spoke | `MISSING` |

## Hygiene to fix before a client sees it

- Leftovers from other customers: the IMI portal and Virtual Agent branding; Ocean Winds'
  health and safety app `x_edpro_incman`.
- Duplicate training apps, a broken UserKit business rule, a duplicate AIA client script,
  overlapping inquiry data lookups.
- 9 records with secrets, redacted in the mirror.
- No domain separation.
- `ignoreFulfillerSubscriptionCheck=true` is set: fine for a demo, must not be shown as client
  configuration.

## What is ready for each journey

| Journey | Ready now | Main gaps |
|---|---|---|
| A. Multilingual service desk | Chat, catalog and incident agents, translation | Voice channel, voice agents off, UI language packs |
| B. Service intelligence | All work, SLA and insight agents and skills | Demo data volume and realism |
| C. Incident troubleshooting | Triage, investigation, LEAP, on-call, KB agents | Monitoring credentials, remediation back-end, Teams |
| D. Change and release | 20 change agents and workflows | Change Predictive Intelligence off |
| E. Reliability and CMDB | SLO, synthetic, Service Mapping, MID Guardian agents | CSDM, Discovery, MID Server, SLO data apps |
| F. Knowledge, experience, governance | KB agents, survey agents, Now Assist Admin agents | Duplicate and gap skills off, guardrails at monitor |
