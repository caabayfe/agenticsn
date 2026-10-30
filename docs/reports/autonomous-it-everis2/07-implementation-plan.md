# Implementation plan

## Workstreams

| Code | Workstream | Owns |
|---|---|---|
| GOV | Governance and platform | Guardrails, AI Control Tower, model providers, hygiene, build conventions |
| ITSM | Service desk and intelligence | Journeys A (chat), B, D, F1 to F3 |
| ITOM | Operations | Journeys C and E |
| VOICE | Voice and language | A1, A2, voice versions of A3 and A4, A6 |
| DATA | Demo data | Users, groups, CIs, services, incidents, alerts, knowledge, changes |
| DEL | Delivery | Storyline, scripts, rehearsals, git, client materials |

## Tasks by phase

### P0 Foundation and governance (2 to 13 Nov)

Sprint 0 "make it real" (R1 to R23) is part of P0. It comes from the live capability tests: see
[capabilities/60-real-plan.md](capabilities/60-real-plan.md).

| ID | Task | Stream | Use case |
|---|---|---|---|
| P0-1 | Remove other customers' leftovers (IMI branding, `x_edpro_incman`), fix the broken UserKit business rule and the duplicate AIA client script | GOV | – |
| P0-2 | Rotate or remove the 9 records holding secrets; document which credentials the demo needs | GOV | – |
| P0-3 | Set the prompt injection guardian to BLOCK in a test, turn on GenAI security detectors, turn on AI Control Tower approvals for new agents | GOV | F5 |
| P0-4 | Pick the default LLM per skill family (Azure OpenAI, Bedrock Claude, Gemini) and record why | GOV | F5 |
| P0-5 | Load demo data: 3 business services with application services and CIs, 200 users in 4 countries, 6 months of incidents, changes, problems and knowledge | DATA | E3, all |
| P0-6 | Answer the entitlement questions (see Prerequisites) | DEL | – |
| P0-7 | Create the update set naming convention and the first update set `AIT-P0-GOV-foundation` | GOV | – |
| P0-8 | Pull the clean baseline with snagentic and tag it `baseline-p0` in the everis2 workspace | DEL | – |

### P1 Assist (16 Nov to 4 Dec)

| ID | Task | Stream | Use case |
|---|---|---|---|
| P1-1 | Turn on and check in product: incident, request, change and problem summarization, resolution notes, KB generation, activity response, email recommendation, sentiment. **Validated 2026-10-28** ([evidence](evidence/p1-1-2026-10-28/README.md)); provider choice open | ITSM | B6, B8, C7 |
| P1-2 | Turn on chat summarization and chat reply recommendation for live agents | ITSM | B6 |
| P1-3 | Configure Now Assist multilingual service and VA language detection for 4 languages; activate Dynamic Translation for Agent Chat | VOICE | A6 |
| P1-4 | Turn on dashboard summarization and analytics query generation on one ITSM dashboard | ITSM | B7 |
| P1-5 | Write the P1 demo script and record it | DEL | – |
| P1-6 | Turn on AI feedback and track accepted, edited and rejected outputs per skill ([G7](evidence/p1-1-2026-10-28/gaps.md#2-gaps-for-the-governed-ai-story)) | GOV | F5 |
| P1-7 | Demo personas with preferred languages; demo scripts with explicit resolution work notes ([G1, G3](evidence/p1-1-2026-10-28/gaps.md#1-gaps-that-make-the-demo-look-weak)) | DEL | A6 |
| P1-8 | Summary card on the RITM page, change risk explanation trigger, one-off sentiment run on demo incidents ([G4 to G6](evidence/p1-1-2026-10-28/gaps.md#1-gaps-that-make-the-demo-look-weak)) | ITSM | B6 |

### P2 Copilot (7 Dec to 15 Jan)

| ID | Task | Stream | Use case |
|---|---|---|---|
| P2-1 | Configure and test: Incident assist, Generate Resolution Plan, Generate my work plan, Analyze task trends, Investigate problems | ITSM | B3, B7, B8, C6 |
| P2-2 | Catalog Agent and Request Status Agent in Virtual Agent and the employee portal | ITSM | A3, A4 |
| P2-3 | Image to ticket on the mobile app | ITSM | A8 |
| P2-4 | Change agents: create, template suggestion, CI suggestion, plans, schedule, standard template proposal | ITSM | D1, D3, D4 |
| P2-5 | Set credentials for one monitoring tool (LogicMonitor) or build a simulated event source; run SRE Investigate in copilot | ITOM | C3 |
| P2-6 | Knowledge health: activate duplicate and gap skills, run on the demo knowledge base | ITSM | F1 |
| P2-7 | Enable Approval Assistance Agent; survey agents on demo surveys | ITSM | F2, F3 |
| P2-8 | Run the use-case factory (Automation Explorer, AI Agent Advisor) on demo data; add the top 3 findings to this repo | DEL | F4 |
| P2-9 | Track acceptance for each copilot use case (accepted, edited, rejected) | DEL | – |

### P3 Supervised (18 Jan to 12 Feb)

| ID | Task | Stream | Use case |
|---|---|---|---|
| P3-1 | Trigger "Triage and categorize ITSM incidents" on incident insert; decide fields written without approval | ITSM | B1 |
| P3-2 | Work Allocator on a schedule for one group; routing rule recommendations | ITSM | B2 |
| P3-3 | Scheduled trigger for Proactive Escalation; escalation policy document | ITSM | B4 |
| P3-4 | Routine customer updates sent automatically for incidents waiting more than N hours | ITSM | B6 |
| P3-5 | Intent to Action with 5 intents and their flows | ITSM | A7 |
| P3-6 | Manage alerts autonomously and impact agents on new alerts; investigation trigger on P1 and P2 | ITOM | C2, C3 |
| P3-7 | On-call lookup and paging in the escalation path; Teams spoke if entitled | ITOM | C5 |
| P3-8 | Wrap-up and resolve incident on resolve; LEAP problem and KB creation with manager validation | ITOM | C6, C7 |
| P3-9 | Change checks on submit (conflict, quality, impact) | ITSM | D2 |
| P3-10 | Evidence check: every agent action leaves a work note; review AI Control Tower logs | GOV | F5 |

### P4 Voice and autonomous operations (15 Feb to 19 Mar)

| ID | Task | Stream | Use case |
|---|---|---|---|
| P4-1 | Connect the telephony channel for AI voice agents; activate the 6 ITSM voice agents and the voice skill configuration | VOICE | A1 to A4 |
| P4-2 | Identity verification flow for voice password reset and unlock (simulated directory) | VOICE | A2 |
| P4-3 | Voice tests in 4 languages; tune prompts and topics | VOICE | A1 |
| P4-4 | Deflection with endpoint agents (Installed App SME, Zscaler SME) on a test device, if tooling is available | ITSM | A5 |
| P4-5 | Activate alert rules for 3 remediation subflows; approval step and safe-fix decision table | ITOM | C1, C4 |
| P4-6 | Ansible Automation Platform or a simulated runbook back-end for LEAP execution | ITOM | C4 |
| P4-7 | SLO, synthetic, Discovery and MID agents where entitled | ITOM | E1, E2, E4 |

### P5 Golden demo (22 Mar to 2 Apr)

| ID | Task | Stream |
|---|---|---|
| P5-1 | Golden storyline end to end, timed | DEL |
| P5-2 | Reset script: data back to the start state in minutes | DATA |
| P5-3 | Short cuts per audience: CIO (10 min), service desk (15 min), operations (15 min) | DEL |
| P5-4 | Two clean rehearsals; final snagentic pull, tag `golden-demo` | DEL |

## Prerequisites

| Prerequisite | Needed for | Status on everis2 |
|---|---|---|
| AI usage allowance (Now Assist assists, AI agents, voice minutes) for a demo instance | Everything | To confirm |
| Telephony integration supported by AI voice agents | A1 to A4 voice | `MISSING` |
| ITOM AIOps and Discovery entitlements (licence plugins are inactive) | C1, E1 to E4 | `OFF` |
| SLO, synthetic monitoring and Health Log Analytics apps | E1, E2 | `MISSING` |
| MID Server | C4, E4 | Unconfirmed |
| Monitoring tool account or simulator (LogicMonitor) | C1, C3 | To configure |
| Microsoft Teams spoke and tenant | C5 | `MISSING` |
| Ansible Automation Platform or simulated back-end | C4 | `MISSING` |
| Endpoint management tooling for device fixes | A5 | `MISSING` |
| Additional UI language packs (only Spanish active) | A6 | `OFF` |

## Build conventions

**No scoped applications.** Everything is built in the Global scope:

| What | Where | Convention |
|---|---|---|
| Agent changes | AI Agent Studio, Global | Copy the out-of-the-box agent, name `AIT <original name>`; never edit the original |
| New tools | AI Agent Studio tools calling flows or subflows | Tool name says what it does, in the agent's language |
| Glue logic | Flow Designer flows, subflows and actions in Global | Prefix `AIT -`; one subflow per tool |
| Scripts | Script includes in Global, only when a flow cannot do it | Prefix `AIT`; no business logic in client scripts |
| Triggers | Agentic workflow triggers | One trigger per use case, documented in the use-case file |
| Policies | Decision tables in Global | Safe-fix list, escalation policy, field write policy |
| Update sets | One per use case or phase | `AIT-<phase>-<use case>-<short name>`, for example `AIT-P3-B1-triage-trigger` |
| Tests | ATF in Global | One test per use case that changes data |

**Git workflow.** The everis2 snagentic workspace keeps the instance mirror in git:

1. Before a phase: `snagentic pull` and tag the start.
2. Build on the instance in the phase's update sets.
3. After each use case: `snagentic pull`, review the diff, commit with the use case ID.
4. End of phase: tag `p<n>-done`; update the use-case files in this repository (status tags,
   current level).

**Environments.** everis2 is the build instance. Before P5, clone it to a second instance as
the golden demo, so rehearsals and builds do not collide.

## Hygiene checklist

- [ ] Other customers' branding and apps removed
- [ ] Duplicate training apps removed
- [ ] Broken UserKit business rule fixed
- [ ] Duplicate AIA client script removed
- [ ] Secrets rotated
- [ ] `ignoreFulfillerSubscriptionCheck` documented as demo-only
- [ ] Guardians at BLOCK, detectors on, AI Control Tower approvals on
- [ ] Inactive alert rules reviewed
