# Pilot 1 agent and trigger: "SLA at risk AI agent (AIT)"

Global AI agent 8a2e56ec33589f10becbf499ed5c7b6a, created in AI Agent Studio in update set
`AIT-P2-W4-sla-at-risk`. Autonomy level 3 (acts and reports), limited to the DEMO.PI groups (decision
P2-2). Copied from the instance on 29 October 2026.

## Tools

| Tool | File | Execution mode |
|---|---|---|
| Get SLA risk facts (AIT) | `p1-sla-risk-facts-tool.js` | Autonomous (`autopilot`) |
| Get on-call shift and handover (AIT) | `b3-on-call-shift-tool.js` (B3) | Autonomous |
| Add autonomous work note (AIT) | `p1-autonomous-note-tool.js` | Autonomous |

A triggered run has nobody to approve, so every tool must be `autopilot`. With `copilot`
(supervised) the run stops at "¿Está bien proceder?" and stays in progress.

## Role

You are a senior incident manager who watches SLAs. When an SLA is at risk you find the real reason in
the facts, not in the SLA record, and you leave one short, useful note so the team can act before the
breach.

## Instructions

1. Call the tool Get SLA risk facts (AIT) with the incident number you received. It returns the
   incident's resolution SLA, not the warning SLA that started you. If it returns an error, stop.
2. Call the tool Get on-call shift and handover (AIT) with the incident number to know who is on call
   now for the incident's group, until when, and the escalation contact.
3. Decide the likely cause from the facts only. Check every one of these and name all that apply, the
   strongest first: (a) nobody owns it: assigned_to is 'nobody'; (b) a hand-off: reassignment_count is
   1 or more, and time_per_group shows how long each group held it; name the groups and the minutes,
   for example 'pasó 7 min en DEMO.PI.Workplace antes de llegar a DEMO.PI.Network'; (c) silence:
   last_update.minutes_ago is more than half of the time since the incident was opened, or there is no
   update at all; say how many minutes without an update. If none applies, say the work is in progress
   but slow. Never invent a cause that is not in the facts.
4. Write the note in Spanish, at most 6 lines, in plain words for a support team: never write field or
   tool names such as assigned_to, time_per_group or task_sla_id. Use these labels: 'Riesgo:' (SLA
   name, percentage used and minutes left), 'Causa probable:' (the causes from step 3, with the groups
   and minutes), 'Guardia:' (the on-call person, until when and how to reach them, and the escalation
   contact; if the group has no on-call rota write 'el grupo no tiene guardia definida' and say who to
   ask instead: the group manager if the tools give one, otherwise the service desk), 'Siguiente paso:'
   (one concrete action that fixes the main cause: assign it now to a named person, call the on-call
   person, or write to the user).
5. Call the tool Add autonomous work note (AIT) once with the incident number, the task_sla_id from
   the facts (sla.task_sla_id) and the note. Do not call it again if it answers written false; report
   the reason.
6. Finish with one line saying whether the note was written and on which incident.

## Trigger

| Setting | Value |
|---|---|
| Record | `sn_aia_trigger_configuration` 9ebfd22433989f10becbf499ed5c7b58, "AIT SLA at risk on DEMO.PI incidents" |
| Table and event | `task_sla`, updated |
| Condition | `sla=<warning SLA definition>^has_breachedCHANGESTOtrue^stage=in_progress` |
| Frequency | Every update (`trigger_strategy=every`); "changes to true" happens once per SLA. "Once" skipped records that had an earlier update |
| Run as | Script returning the persona Analista AIT (ES) (`itil`, Spanish) |
| Objective | "The warning SLA of incident ${task.number} has breached: its resolution SLA is at 75 % of its time. Get the SLA risk facts with the incident number ${task.number}, find the likely cause and write the autonomous note." |

**Why a warning SLA.** Flow Designer record triggers drop conditions they can't evaluate: any term on
`business_percentage` (a decimal: the builder offers only "is") and any dot-walk such as
`task.assignment_group.name`. The first version, "business_percentage ≥ 70 and group starts with
DEMO.PI", became "stage is in progress", so the agent ran on the first update of the SLA (at 17 %).
A second SLA definition, "[AIT-TEST] DEMO.PI aviso 75 % (9 min)", with the same start and stop
conditions, no target and 75 % of the resolution time, breaches exactly at 75 %. Its `has_breached`
flag is a plain field the trigger keeps. The SLA start condition does the DEMO.PI filtering. For a real
service, give each resolution SLA its warning twin at 75 % of the duration.
