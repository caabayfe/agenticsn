# Agent catalog

IT-relevant AI agents on everis2, from the mirror of 2026-10-27, grouped by application.
"Used in" lists the use cases that name the agent; it is generated from the use-case files.
Status: `ON` enabled, `OFF` present but disabled. Type `custom` means the agent was created or copied on the instance.

## ITSM (`sn_itsm_aia`, 38)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Additional incident context AI agent | `ON` | custom | Additional incident context AI agent retrieves information beyond the incident itself - caller's hardware assets, caller's recent incidents (including lookup by... | A1, B8, C2 |
| CAB Configuration Agent | `ON` | template | Helps administrators configure a Change Advisory Board (CAB) Definition. Accepts full manual input for CAB Members, one CAB Manager, and CAB Scheduling —then presents... | D4 |
| Categorize ITSM incident AI agent | `ON` | template | Categorize ITSM incident AI agent assigns appropriate category and subcategory to an incident. | A1, B1 |
| Change CI suggestion AI agent | `ON` | template | This agent first checks whether the Change Request's Primary CI (cmdb_ci) is populated, then suggests a list of relevant Configuration Items (CI's) to the user that... | D1 |
| Change Models Configuration Agent | `ON` | template | Business Challenge: Organizations need properly configured change models to control how changes flow through assessment, authorization, implementation, and review... | D4 |
| Change Request Plans AI Agent | `ON` | template | The Change Request Planning Agent helps change owners and approvers by drafting high-quality, context-aware change request content. It generates five plans in... | D3 |
| Change Risk Configuration Agent | `ON` | template | This agent helps Change Administrators review, understand, and update the Risk Assessment configuration used in Change Management. It retrieves the current risk... | D4 |
| Change Schedule Configuration Agent | `ON` | template | AI-assisted Change Schedule Configuration Agent that guides change administrators through creating, editing, cloning, and managing Blackout and Maintenance schedules... | D3 |
| Change Team Role Configuration Agent | `ON` | template | Helps IT administrators configure Change Management team roles by assigning or removing the Change Manager and Change Implementer roles for users and groups using... | D4 |
| Change conflict assessor AI agent | `ON` | template | Change conflict assessor AI agent autonomously evaluates a Change request's configuration item, planned start date, and planned end date. When all three are... | D2 |
| Change outage assistant AI agent | `ON` | template | Creates outage records for the change request based on the CIs that are as being impacted by the change request | D2 |
| Change quality assessor AI agent | `ON` | template | Checks whether a change quality policy document exists for the model of a given Change Request then routes the assessment to the Change quality assessor using change... | D2 |
| Change quality assessor using change policy documents AI agent | `ON` | template | Scores the quality of a Change Request field-by-field against a defined change policy document, delivers a structured quality rating and records the assessment. | – |
| Change quality assessor using similar changes AI agent | `ON` | template | Benchmarks the quality of a Change Request field-by-field against closed, successfully completed changes of the same type, delivers a structured quality rating with... | – |
| Change template suggestion agent | `ON` | template | This agent is responsible for inferring what, why, how, and when a described change involves, asking one batched clarifying question only when genuinely needed and... | D1 |
| Classify service and CI AI agent | `ON` | template | Incident service and offering categorizer assigns the appropriate service and offering to an incident. It can also assign the appropriate configuration item. Use... | A1, B1 |
| Create Incident AI Agent | `ON` | template | Responsible for managing the end-to-end process of formally logging IT support requests, specifically for user requests like create an incident, raise an incident,... | A1, A5 |
| Create change request agent | `ON` | template | Use this agent whenever the user wants to create, raise, log, file, open, submit, or request a new Change Request (CHG) — no matter how much detail they give,... | D1 |
| Find catalog item AI agent | `ON` | template | This AI agent identifies relevant catalog items for a given incident and adds all detected catalog item links to the incident's additional comments. | A3 |
| ITSM incident resolution investigation AI agent | `ON` | template | Get details of incident, add to incident attached knowledge articles, add to incident additional comments, AIA RAG retriever, get similar Incidents | – |
| ITSM incident resolution plan investigation AI agent | `ON` | template | Get details of incidents, add to incident work notes, AIA RAG retriever, get similar Incidents, check for related catalog items. | C3 |
| Incident Category Configuration AI Agent | `ON` | template | This AI Agent orchestrates the complete lifecycle of incident category and subcategory configuration for the sys_choice table. It supports three interaction modes:... | – |
| Incident context AI agent | `ON` | template | Incident context AI agent helps users answer questions related to one or more incidents using information from incident records and their related records. Supports... | A1, B5, B8, C2 |
| Incident knowledge article AI agent | `ON` | template | This agent can resolve incident, fetches existing similar knowledge articles and attach relevant knowledge article to the incident based on user input. It can create... | C7 |
| Incident known error article AI agent | `ON` | template | This agent can fetch existing similar known error articles and attach a relevant known error article to the incident based on user input. If existing known error... | C7 |
| Incident resolution details AI agent | `ON` | template | Suggest resolution notes for the provided incident and update the incident with resolution notes and code based on user confirmation. | C7 |
| Incident routing configuration agent | `ON` | template | An AI-based agent that helps create, modify, and deactivate assignment rules for ServiceNow incident routing **Key Areas:** - AI-powered routing rule recommendations... | B2 |
| Installed App SME Agent | `ON` | template | Diagnoses and remediates crash, freeze, and slowness in installed desktop applications on managed end-user devices. Covers browsers (Chrome, Edge, Firefox, Safari)... | A5, C4 |
| Link incident to problem AI agent | `ON` | template | This agent helps in linking incident to a problem which is created in last 6 months. | C6 |
| Link major incident AI agent | `ON` | template | Link major incident AI agent | – |
| Link major incident or problem AI Agent | `ON` | template | AI Agent to automatically identify and link the most relevant Major Incident or Problem to a given incident by analyzing short descriptions, verifying contextual... | B1 |
| On Call Retrieval | `ON` | template | A read-only, standalone On-Call Retrieval agent that looks up who is currently on call, scheduled on call, or covering a given shift/rotation for a named group,... | C5 |
| On Call Shift Creator | `ON` | template | An intelligent agent that creates on-call shifts by guiding users through group selection, template or manual schedule configuration, member assignment, and rotation... | C5 |
| Post incident review AI agent | `ON` | promoted | This AI agent generates post incident review report for the user to review and revise based on feedback and update major incident report. | C7 |
| Schedule Change Request AI Agent | `ON` | template | Schedules a given Change | D3 |
| Standard change template proposal AI agent | `ON` | template | Provided a change, this agent search for similar changes, list the similar changes down. User can choose the changes that the think is good candidate for the template... | D4 |
| Standard change template recommender AI agent | `ON` | template | This agent helps users create and submit Change Requests in ServiceNow. Invoke it whenever the user asks to log, create, submit, initiate, or help with a change... | D1 |
| Zscaler SME AI Agent | `ON` | template | Diagnoses and remediates Zscaler connectivity and performance issues on managed endpoint devices. Evaluates ZPA status, VPN health, jitter, etc., to identify root... | A5, C4 |

## ITSM voice (`sn_itsm_voice_aia`, 6)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Create incident with voice AI agent | `OFF` | template | This voice AI agent assists users with creating new incidents. This agent should be used when the user explicitly mentions they want to create a new incident or... | A1 |
| Manage ticket with voice AI agent | `OFF` | template | This voice AI agent assists users with managing their active tickets, which are incidents and requested items. This agent is capable of fetching ticket details,... | A4 |
| Password reset with voice AI agent | `OFF` | template | This voice AI agent assists users in regaining account access by identifying password reset needs during phone-based interactions. The agent helps users by sending a... | A2 |
| Request catalog item with voice AI agent | `OFF` | template | This voice AI agent assists users in finding and delivering catalog items. If the item is not categorized as software, then the catalog link is sent through email or... | A3 |
| Submit account unlock catalog with voice AI agent | `OFF` | template | This voice AI agent assists users in unlocking accounts by invoking a tool call to submit an account-unlock catalog request. This agent should be used when the user... | A2 |
| Troubleshoot outlook issue with voice AI agent | `OFF` | template | This voice AI agent assists users with troubleshooting Outlook issues. It also supports sending troubleshooting article link to the user by email when requested. This... | A5 |

## Platform (work, SLA, insight) (`sn_uxc_gen_ai`, 18)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Decomposition Agent | `ON` | template | The Decomposition Agent intelligently takes resolution steps as input, analyzes and breaks down each resolution step into a clear, structured set of smaller,... | B8 |
| Explain SLA | `ON` | template | This agent can be used to perform the following actions: - Get matching SLA for given task number - Explain SLA breakdown - Display Task SLA details - Provide SLA... | A4, B4 |
| Image Processor Agent | `ON` | template | This agent enables users to upload image attachments and create task records by analyzing them. It utilizes the Document and visual insights AI agent to analyze the... | A8 |
| Issue readiness | `ON` | template | This agent scans the record fields and actual context of the ticket so it can determine if it is ready for me to work on it or not. | B1 |
| Issue trend analysis AI agent | `ON` | template | Analyzes grouped task data that could be of cases/incidents/problems or other tables extending the Task table — to identify recurring issues and root causes. Provides... | B7, C6 |
| Next action recommendation AI agent | `ON` | template | The Next best action recommender identifies the optimal steps for resolving tasks by referencing similar record details, related list record details, reviewing... | B8 |
| Prioritize work AI agent | `ON` | template | Responsible for retrieving user-assigned tasks, scoring them by priority using metadata and SLA data, generating time-blocked work plans based on calendar... | B3 |
| Proactive Escalation AI Agent | `ON` | template | Proactive Escalation AI Agent will assess open task records to determine if they require escalation. The agent will fetch all open tasks, process the escalation... | B4, C5 |
| Problems investigation AI agent | `ON` | template | The Problems investigation AI agent agent specializes in root cause identification, impact assessment, and resolution planning. It analyzes problem details,... | C6 |
| Record field value prediction AI agent | `ON` | template | Field Predictor can predict fields of an incoming task/record by gathering incoming task sys_id. It can also provide a summary and justification of the field predictions. | B1 |
| Record management AI agent | `ON` | template | This agent can be used to perform the following actions: - Fetch a record, - Create a record, - Update a record, - Copy an attachment to a record, - Link a Knowledge... | A8 |
| Suggested Actions AI Agent | `ON` | template | Surfaces tool-generated next-step recommendations and executes the user's chosen action on a record (incident, case, task). Invoke whenever the user asks for next... | B3, B4, B8, C4 |
| Survey Analysis AI agent | `ON` | template | Survey analysis agent with intelligent date parsing (natural language, relative expressions, fiscal terms), dates validation, and multi-dimensional analysis. Extracts... | F2 |
| Survey filling data collection AI agent | `ON` | template | This agent collects data related to the case/incident/request and the survey questions raised to collect feedback on those case/incident/request. | – |
| Survey response suggestion AI agent | `ON` | template | This agent suggests answers to questions in the survey by using details from case/incident/request. | F2 |
| Update work plan AI agent | `ON` | template | Responsible for receiving structured plan data, constructing a valid JSON payload conforming to the database schema, validating and repairing malformed JSON if... | B3 |
| Web research and recommendation AI agent | `ON` | template | This agent is designed to assist users in resolving issues by analyzing the problem and generating resolution steps using web search tools. It is intended for users... | A5, B8 |
| Work Allocator AI Agent | `ON` | template | Designed for support team managers and operations leads, this agent streamlines ticket management by automatically fetching backlog tickets, evaluating agent... | B2 |

## Observability (`sn_obs_aia`, 15)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| AWS CloudWatch API Agent | `ON` | template | Responsible for end-to-end investigation of AWS CloudWatch alarm firings by querying alarm configuration, metric time series, log groups, ML anomaly detectors, and... | – |
| AWS CloudWatch MCP Server Agent | `ON` | template | Automates AWS CloudWatch alert investigations by analyzing alarm details, querying affected resources, retrieving CloudWatch metrics and logs across multiple... | C3 |
| Azure Monitor MCP Agent | `ON` | template | Investigates Azure Monitor alerts by querying Log Analytics workspaces (KQL), platform metrics, activity logs, and resource health via Azure MCP tools. Returns... | C3 |
| Datadog APM MCP Server Agent | `ON` | template | Queries Datadog APM observability data via the Datadog MCP server to answer questions about service health, distributed traces, monitors, logs, incidents, SLOs, and... | – |
| Dynatrace MCP Server Agent | `ON` | template | Investigates Dynatrace alerts by retrieving alert impact summaries and querying the Dynatrace API for problem details, entity enrichment, log analysis, and root cause... | C3 |
| Gemini Cloud Assist A2A Investigation Agent | `ON` | template | Investigates Google Cloud (googlemonitor) alerts by driving a Gemini Cloud Assist (GCA) investigation via Google's A2A investigation endpoint: it starts an... | C3 |
| Kentik analysis AI agent | `ON` | template | Fetches the incident insights report for a Kentik alert. | – |
| LogicMonitor API Agent | `ON` | template | Given a LogicMonitor-originated alert or an operator-initiated request to check a specific LogicMonitor-monitored entity, the agent resolves the entity, classifies... | C3 |
| Network SME Agent | `ON` | template | Senior network diagnostic agent. Investigates network issues using either alert-driven context or direct network identifiers, identifies the exact bottleneck location... | C3 |
| New Relic MCP Server Agent | `ON` | template | Queries New Relic observability data via the New Relic MCP server to answer questions about entities, logs, alerts, metrics, service dependencies, and change events. | – |
| Prometheus API Agent | `ON` | template | Answers observability questions about infrastructure by querying Prometheus metrics, instant queries, and range queries via the Prometheus HTTP API. | – |
| SRE Investigate AI Agent | `ON` | template | Primary Responsibility: Coordinates investigation activities across multiple observability platforms by orchestrating tool-specific agents (Dynatrace MCP, New Relic... | C3 |
| SolarWinds analysis AI Agent | `ON` | template | Fetches the details related to a SolarWinds alert. | – |
| Splunk MCP Server Agent | `ON` | template | Investigates Splunk Cloud Platform alerts by querying SPL-based Splunk platform data via MCP tools, including SPL execution, saved search retrieval, ownership... | C3 |
| ThousandEyes MCP Server Agent | `ON` | template | Investigates ThousandEyes tests by retrieving test configuration, analyzing metrics and anomalies, correlating network events and outages, performing path... | C3 |

## AIOps (`sn_aiops_ai_agents`, 6)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Alert Automation AI Agent | `ON` | template | This agent interprets free-text user requests related to alert automation and guides users to the appropriate automation experience. It detects whether the user... | C1 |
| Alert Impact Verification AI Agent | `ON` | template | This agent is responsible for eligibility validation for a given alert, to perform impact analysis on it. | C2 |
| Business And Technology Management Service Impact Analysis AI Agent | `ON` | template | This agent calculates the business and technology management services impacted by a given alert. | B5, C2 |
| Manage alerts AI agent | `ON` | template | Responsible for generating reports for a given alert, applying summarization tools, and storing a structured summary with key insights and recommended next steps in... | C2 |
| Service instance impact analysis AI agent | `ON` | template | This agent performs alert impact analysis on service instances for a given alert | B5 |
| User impact analysis AI Agent | `ON` | template | This agent investigates incidents and cases related to the alerts and affected services. | B5 |

## LEAP (`sn_itom_leap`, 5)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Artifact creation agent | `ON` | template | Assists in creating and viewing artifacts like Problem record, KB article and Playbook for an automation opportunity. | C6, F4 |
| LEAP Ansible Agent | `ON` | template | This is the LEAP Ansible Discovery Agent responsible for finding the most appropriate Ansible job templates and persisting them to the Discovered Job Catalog. | C4 |
| LEAP Ansible Execution Agent | `ON` | template | Executes mapped Ansible automation playbooks for incident remediation by reading step-to-job mappings and launching jobs via Ansible Automation Platform. Reports job... | C4 |
| LEAP KB Creation Agent | `ON` | template | Creates draft KB articles from LEAP cluster resolution steps using KBController. | C7 |
| LEAP Problem Creation Agent | `ON` | template | Creates Problem records from LEAP cluster data using ProblemController. | C6 |

## MID Guardian (`sn_itom_mid_grdn`, 4)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| MID common AI agent | `ON` | template | Assists MID users and support personnel in identifying, analyzing, and resolving MID Server issues by retrieving error logs, collecting necessary details from users,... | – |
| MID keystore AI agent | `ON` | template | Assists users in diagnosing and resolving MID Server keystore-related problems. Capable of fetching mid server and issue details, executing rekey and validation... | – |
| MID network AI agent | `ON` | template | Assists ServiceNow administrators and support personnel in debugging and resolving MID server reachability issues to ServiceNow Instance. The agent provides clear,... | – |
| MID upgrade AI agent | `ON` | template | Assists IT administrators in diagnosing and resolving 'Upgrade Failed' issues on MID servers by automating the identification, script deployment, error collection,... | – |

## Knowledge (`sn_km_gen_ai`, 2)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| KB content consolidation AI agent | `ON` | template | AI Agent for detecting duplicate articles. | F1 |
| KB content creation AI agent | `ON` | template | The Knowledge Creator Agent specializes in retrieving writable Knowledge Bases and generating a Knowledge Article in the specified Knowledge base. | F1 |

## Notifications and email (`sn_notif_agents`, 5)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Email Generator Agent | `ON` | template | Handles composing and sending emails — including new messages or replies — based on the provided context , send or draft emails. | A7, B6, C5 |
| Intent Executor Agent | `ON` | template | Fetches and executes admin-defined actions, associated to intent or intents configured by the admin in case of intent(s) match and admin defined default actions in... | A7 |
| Intent Identification Agent | `ON` | template | Fetches the email body using given email sys_id, analyses and compares the intent of the email body against a list of intents by evaluating using specific set of metrics. | A7 |
| Notification Agent | `ON` | template | Designed to help users create or edit notification records through natural‑language interaction. The agent determines whether the user intends to create or update a... | – |
| Notification Content Agent | `ON` | template | Notification Content Agent is an AI agent that prepares email notification templates and layouts. It begins by analyzing user requirements—provided as structured... | B6 |

## Requester (`sn_na_req_agent`, 2)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Approval Assistance Agent | `OFF` | template | Handles all queries related to approval records. Retrieves and filters approval records that are pending action from the logged-in user. Provides detailed information... | A3, F3 |
| Request Status Agent | `ON` | custom | This AI agent is strictly limited to inquiries about existing ServiceNow tickets that were created by or are currently opened by the logged-in user. It should be... | A4 |

## Catalog (`sn_now_assist_cr`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Catalog Agent | `ON` | template | Responsible for gathering, validating, and tracking all required inputs for a given Catalog Item. The Catalog Agent prompts the user for each variable, records and... | A2, A3 |

## Reliability (SLO) (`sn_ai_agents_slo`, 3)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Reliability Domain Agent | `ON` | template | Analyzes P1/P2 incidents to detect SLO and synthetic monitoring gaps for the affected CI and create Reliability Task records for remediation. | E1 |
| SLO Creator Agent | `ON` | template | Creates service level objectives for a configuration item or service by examining historical incidents, outages, and alerts. Designed for reliability engineers and... | E1 |
| SLO Gap Agent | `ON` | template | Detects SLO coverage gaps for a given incident and impacted CI. Checks whether any alert linked to the incident is tracked by an existing SLO and whether an... | E1 |

## Synthetic monitoring (`sn_ai_agent_syn`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Synthetic Creator Agent | `ON` | template | Analyzes synthetic monitoring coverage for CMDB HTTP endpoints associated with an incident. Discovers related service endpoints, identifies monitoring gaps... | E2 |

## Service Mapping (`sn_sm_gen_ai`, 4)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Analyze Potential Impact Agent | `ON` | template | Analyzing potential impact on services in Change Management involves identifying and documenting the services affected by a proposed change. This process includes... | D2 |
| CSDM Business Application to Infrastructure AI Specialist | `OFF` | custom | Connect CSDM model to application service | E3 |
| Service Map Creation AI Specialist | `OFF` | template | Discovers service infrastructure from an Application Service candidates using ML analysis, then maps and persists the full service topology in CMDB. | E3 |
| Tag-Based Service Map Creation AI Specialist | `ON` | custom | Analyses tag-based candidates (svc_by_tags_candidates) using running process data and creates Application Service topologies in CMDB when meaningful business service... | E3 |

## Discovery (`sn_discovery_ai_ag`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Pattern Diagnostic Agent | `ON` | template | Analyzes CMDB CI data quality using Discovery pattern metadata. Identifies missing attributes, parses discovery logs to diagnose failures, and prepares error data for... | E4 |

## Error Framework (`sn_ef_gen_ai`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Error Analysis and Remediation Agent | `ON` | template | Expert in ServiceNow Error Framework analysis and remediation. Helps admins and operators investigate Error Framework error codes, analyze root causes and execute... | E4 |

## Automation Center (`sn_ac_assist`, 2)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Automation Finder | `ON` | template | An expert who fetches automations (records) from the table based on this extensive knowledge of Servicenow tables | F4 |
| Automation Table Discovery Agent | `ON` | template | Your job is to help identify the most relevant “execution / run / job / process / tracker” tables for a user’s request, using: a small query set derived from the user... | F4 |

## Web automation (`sn_naa`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Web Automation Agent | `ON` | template | Executes automated actions across any web page, enabling form filling, clicking, data extraction, and navigation tasks. | C4 |

## Analytics (`sn_text2analytics`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Data Visualization Generation Agent | `ON` | template | Responsible for interpreting user requests for data visualization, charting, and reporting, then generating the appropriate visual output in formats including list,... | B7 |

## AI analytics (`sn_na_analytics`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| AI Analytics Q and A | `ON` | template | Answers natural language questions about AI Analytics. Covers KPI definitions, dashboard widgets, source tables, data flows, deflection log states and scenarios, the... | B7, F5 |

## Document intelligence (`sn_docintel_gen_ai`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Content insights AI agent | `ON` | template | This agent helps with tasks related to processing of documents and provides three main capabilities: 1. **Question and Answer (QnA)** (default)- Answers specific... | A8 |

## Now Assist Admin (governance) (`sn_na_center`, 15)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Data and Policy Configuration Agent | `ON` | template | Manages Data and Policy configuration for AI. Retrieves the list of privacy policies, data patterns, data sharing and Data overflow processing details and displays it... | – |
| Edit Model Provider Agent | `ON` | template | MANAGE model providers — handles both editing AND viewing integration types. Use this agent when user wants to CHANGE, UPDATE, SET, EDIT, MODIFY, or SWITCH the... | – |
| Guardian Settings Modifier Agent NAC | `ON` | template | Modifies AI Guardian settings including Prompt Injection, Offensiveness, and Filters based on structured payload. Supports severity/threshold configuration for Prompt... | – |
| Guardian Settings Viewer Agent NAC | `ON` | template | Retrieves and displays AI Guardian settings based on natural language queries. Shows only the requested information from Prompt Injection, Offensiveness, and Filter... | – |
| Language Configuration Agent | `ON` | template | Handles language configuration for AI multilingual service model providers. Retrieves the list of model providers and their configured languages, adds or removes... | A6 |
| Model Provider Policy Agent | `ON` | template | AI Agent for viewing AI model provider policy summary through NAP conversation | – |
| Model Provider Query and History Agent | `ON` | template | VIEW and QUERY model provider information and history. Use when user wants to VIEW, SHOW, DISPLAY, FIND, or SEE: current providers for skills/groups, policy history,... | – |
| Model Version Modifier Agent | `ON` | template | Creates, updates or removes Instance and skill level model version configurations based on the user queries. | – |
| Model Version Viewer Agent | `ON` | template | Retrieves and displays Model version configurations based on the user queries. Fetches the active and deprecated models that are being used in the instance, instance... | – |
| NAC Help Agent | `ON` | template | Answers help questions by querying the help knowledge base. Routes here when users ask how do I, what is, help with, or similar help-seeking questions. | – |
| SHA Diagnostic Agent | `ON` | template | Runs configuration diagnostics and presents actionable results to the admin. | F5 |
| SHA Triage Agent | `OFF` | template | Assesses whether the admin's AI problem description contains enough information to produce a meaningful diagnosis. Asks at most one targeted clarification question... | – |
| Skill Configuration Agent | `ON` | template | The Skill Configuration Agent manages all configuration operations for AI Skills. This agent serves as the execution layer for skill activation, deactivation, and... | – |
| Skill Discovery Agent | `ON` | template | The Skill Discovery Agent specialises in retrieving AI skill information and preparing pre-formatted display payloads for the Skill Management Workflow. This agent... | F5 |
| Translation Settings Agent | `ON` | template | Handles translation toggle operations and status inquiries for AI multilingual services. Users may refer to Native Translation as NT and Dynamic Translation as DT.... | A6 |

## AI security (`sn_ai_security`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| AICT Security Analyzer Agent | `OFF` | template | Responsible for generating the security event context for each detected AI security event record ID, aggregating the detected AI security event, monitored asset... | F5 |

## Implementation (instance set-up) (`sn_ia_now_assist`, 11)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| Group and roles assignment agent | `ON` | template | Provisions access by creating groups and managing user-to-group, user-to-role, and role-to-group assignments. | – |
| IA Operational Data Workflow Agent | `ON` | template | Automates data import configuration by creating data sources, import sets, and transform maps. Designed for IT administrators and system integrators who need a... | – |
| Implementation Agent Orchestrator | `ON` | template | This is an orchestrator agent, responsible solely for controlling the interaction lifecycle between the user and the items or the UI pages. | – |
| Implementation Plan Executor Agent | `ON` | template | The agent is responsible for executing the implementation plan, carrying out each defined step, and ensuring the plan is completed as designed. | – |
| Implementation Plan Generator Agent | `ON` | template | The Implementation Plan Generator Agent is designed to automate the creation of detailed, step-by-step implementation instructions within ServiceNow. It generates a... | – |
| Implementation Plan Manager Agent | `ON` | template | The Implementation Plan Manager Agent orchestrates the complete implementation lifecycle by coordinating the Plan Generator and Plan Executor agents. It ensures that... | – |
| Initialize IA Orchestrator Agent | `ON` | template | This agent is designed for administrators and end users responsible for configuring a ServiceNow instance. Its primary function is to automatically trigger the... | – |
| SLA Management AI Agent | `ON` | template | SLA Management AI Agent enables administrators to create and edit SLA definitions through a conversational interface. The agent guides administrators through the... | – |
| SSO Configuration Agent | `ON` | template | Guides IT administrators through secure Single Sign-On (SSO) setup for ServiceNow using SAML or OpenID Connect (OIDC). The agent collects and validates Identity... | – |
| Step Executor | `ON` | template | This agent is responsible solely for launching child agents and providing a handoff to the parent agent. When invoked, it receives a JSON object in its `task` input... | – |
| Update Set Agent | `OFF` | template | Designed for administrators and developers who need to upload, review, and commit XML update sets efficiently. | – |

## Navigation (`sn_nowassist_gs`, 1)

| Agent | Status | Type | What it does | Used in |
|---|---|---|---|---|
| ServiceNow Record Navigator | `ON` | template | Surfaces ServiceNow records as clickable navigation views. Use this agent when the user wants to show, find, list, fetch, display, get, view, pull up, look up,... | – |

146 agents listed. Not listed: agents for project management (SPM), document generation, playbooks and other non-IT areas; see the mirror for the full set of 159.
