# W4.1 spike: how an event starts an agent on everis2 (29 October 2026)

Question: which trigger can start an AI agent on its own, which user it runs as, and in which
language it writes. Answer: an **AI agent trigger** on the agent itself, run as a **real `itil`
user** through a run-as script, and the language follows that user's profile.

## What the platform offers

| Option | How | Use it? |
|---|---|---|
| AI agent trigger (`sn_aia_trigger_configuration`) | AI Agent Studio, agent setup, "Añadir desencadenadores": a table, a condition, a frequency, a run-as user and an objective template | **Yes.** No code, one record per use case, an off switch |
| Scheduled trigger | The same record with a schedule | Later, for periodic checks (W6) |
| Flow action "Start AI agent" from a custom flow | Flow Designer | Not needed: the trigger already builds a flow |
| Business rule calling the agent API | Script | No: more code, and no off switch in the Studio |

The six OOB trigger records on the instance are inactive examples. They run as `assigned_to` or
`requested_by`.

## How a trigger works

- Saving a trigger creates a Flow Designer flow with a record trigger on the table. The flow calls
  `sn_aia.AIATriggerUtilSNC.invokeAIA(current, context, trigger, userId)`.
- The objective template fills `${field}` from the record, with dot-walk (`${task.number}`,
  `${sla.name}`), so the agent receives the record id and the facts it needs to start.
- **Frequency** (`trigger_strategy`): every update, once, each unique change, or only if not running.
  The Studio form showed "Una vez" while the record stayed empty, and the trigger then fired on every
  update of the SLA record: **six runs in four minutes** for one SLA (the note tool wrote only one
  note). Setting `trigger_strategy` to `once` fixed it. Check the field after saving a trigger.
- **The flow keeps only part of the condition.** Flow Designer record triggers drop any term on
  `business_percentage` (a decimal: its builder offers only "is") and any dot-walk such as
  `task.assignment_group.name`. The Studio still shows the full condition, but the flow ran on
  "stage is in progress" only, at 17 % of the SLA. Tested with `>=`, `>`, `BETWEEN` and dot-walks on
  the group: all dropped. Plain fields (`stage`, `sla`, `has_breached`) are kept.
- **Fix: a warning SLA.** A second SLA definition with the same start and stop conditions, no target
  and 75 % of the duration breaches exactly at 75 %; the trigger fires on its `has_breached=true`, once.
  The SLA start condition does the DEMO.PI filtering. (The percentage also moves only when SLA timers
  run: the 75 % timer of the real SLA wrote 74.58 %, another reason not to compare percentages.)

## Which user it runs as

- `task_sla` has no user field, so "run as a field" is not possible. The pilot uses a **run-as
  script** that returns the persona **Analista AIT (ES)** (`itil`, Spanish).
- An agent run as `system` or as a user without roles is blocked (R7: 78 blocked runs in the
  capability assessment). The agent's data access is "dynamic user" with role `itil`.
- The run-as user is the author of the work note. Every autonomous note is therefore written by
  the persona, with the prefix `[AIT auto · SLA en riesgo]`, so it is easy to find and count.

## Supervised or autonomous

Each tool of the agent has an execution mode (`sn_aia_agent_tool_m2m.execution_mode`):
`autopilot` (autonomous) or `copilot` (supervised). **A triggered run has nobody to approve**: with a
supervised tool the plan stops at "¿Está bien proceder?" and stays in progress forever. Level 3
pilots need `autopilot` on every tool; the guardrails then live in the write tool (W4.5).

## Language

The thoughts and the note come out in Spanish because the run-as persona's profile is Spanish
(L7). The agent instructions also ask for a Spanish note. This is evidence for decision 4: the
language of autonomous notes is set by the run-as user, not by the reader.

## Off switch

1. Deactivate the trigger (Studio or `sn_aia_trigger_configuration.active`): no new runs.
2. Deactivate the agent: runs in flight fail.
3. The write tool refuses non-DEMO.PI groups, a second note per SLA, and more than 20 notes a day.
