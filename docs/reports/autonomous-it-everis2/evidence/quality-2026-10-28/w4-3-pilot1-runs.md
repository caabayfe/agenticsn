# W4.3 pilot 1, SLA at risk: build and first runs (29 October 2026)

Acceptance (`60-real-plan.md`): a note within 5 minutes on 5 of 5 test incidents, score 10 or more out
of 12, only on DEMO.PI groups. Status: **not passed yet**. The agent writes useful notes within 30
seconds, but the trigger and the instructions needed fixes, and the last fix waits for the instance to
be back on the Global application (see "Blocked" below).

Agent, tools and trigger: [`build/p1-agent-and-trigger.md`](../../build/p1-agent-and-trigger.md).
Trigger findings: [`w4-1-trigger-spike.md`](w4-1-trigger-spike.md).

## Test design

Five `[AIT-P1]` incidents per round, caller Analista AIT (ES), on a 12-minute test SLA that only starts
for DEMO.PI groups. Each one has a different answer key:

| Case | Set-up | Expected cause | Expected on-call line |
|---|---|---|---|
| R1 | DEMO.PI.Workplace, moved to DEMO.PI.SAP after 3 min, nobody assigned | Nobody owns it, and 3 min lost in Workplace | Marta Ruiz, escalation Elena Soto |
| R2 | DEMO.PI.SAP, assigned to Jordi Puig, no notes | Silence since it was opened | Marta Ruiz |
| R3 | DEMO.PI.SAP, assigned to Marta Ruiz, progress note at 6.5 min | Work in progress, but slow | Marta Ruiz |
| R4 | DEMO.PI.M365, moved to DEMO.PI.SAP and assigned to Marta Ruiz after 3 min | Hand-off: 3 min lost in M365 | Marta Ruiz |
| R5 | DEMO.PI.Network, nobody assigned | Nobody owns it | The group has no rota: ask the service desk |

## Round 0: INC0026068 (first fire)

The trigger fired six times in four minutes (frequency stored empty, so "every update") and from 66 %.
The tools were supervised, so four runs stopped at "¿Está bien proceder?". One run completed and wrote
the note; the others were refused by the note tool ("This SLA already has its autonomous note"):

> Riesgo: [AIT-TEST] DEMO.PI resolución (12 min), 91 % usado, 1 min restante.
> Causa probable: nadie asignado (assigned_to es nobody).
> Guardia: sin guardia definida. Siguiente paso: asignarlo ahora …

Fixes: tools set to autonomous (`autopilot`), frequency set to once, cause rules rewritten.

## Round 1: INC0026069 to INC0026073

Only INC0026072 and INC0026073 ran, both at **17 %**: the flow had kept only "stage is in progress"
from the condition. The hand-off note on INC0026072 was already good:

> Causa probable: hubo un traspaso; pasó 14 s en DEMO.PI.M365 antes de llegar a DEMO.PI.SAP, donde
> lleva 1 min.
> Guardia: Marta Ruiz (Soporte SAP) hasta 2026-11-01 23:59; contacto +34 600 100 201 /
> marta.ruiz.sap@example.com. Escalación: Elena Soto, +34 600 100 203.

Fix: the warning SLA "[AIT-TEST] DEMO.PI aviso 75 % (9 min)" and a trigger on its breach.

## Round 2: INC0026074 to INC0026078

The warning SLAs breached at 21:08:26 to 21:08:30 UTC. No run started before that.

| Case | Incident | Ran | Note at | Score | Notes |
|---|---|---|---|---|---|
| R1 | INC0026074 | Yes | +28 s | 8 | Missed the 3 min in Workplace; "(assigned_to = nobody)" leaks a field name; right on-call and next step (assign to Marta Ruiz) |
| R2 | INC0026075 | Yes | +30 s | 10 | "silencio; sin actualizar desde hace 9 minutos"; right on-call and escalation; next step "call the on-call person" where "ask Jordi Puig" fits better |
| R3 | INC0026076 | **No** | - | - | The trigger did not start |
| R4 | INC0026077 | **No** | - | - | The trigger did not start |
| R5 | INC0026078 | Yes | +21 s | 7 | Field name leak; "sin guardia definida" without saying who to ask; vague next step |

Timing passes (21 to 30 seconds). Quality does not: these runs used the **old** instructions. Opening
the agent in the AI Agent Studio wizard on 29 October at 20:51 saved the form, and the form held the
instructions of the agent's version record, which still had the old text. The new cause rules
(hand-off with groups and minutes, no field names, who to ask when there is no rota) were lost.

**"Once" misses records.** R3 and R4 got an update before the threshold (a work note, a
reassignment), and their trigger never started. R1 also had a reassignment and did start, so the rule
is not clear. Next test: the condition "has_breached changes to true" with frequency "every update".

## Blocked

At 21:06 UTC the same admin user started working in the **LuxLab** application (Now Assist skill
settings in the Default set of LuxLab), from another session. With LuxLab as the current application,
Global records are read-only: the agent update returns 403 and the Studio shows "Solo lectura". Switching
the application back would disrupt that session, so the last two fixes wait:

1. Write the instructions again through the Studio, so the version record holds them too.
2. Change the trigger condition to "has_breached changes to true", then round 3 with five new
   incidents and the guardrail tests (W4.5).

## Data and revert

| What | Where | Revert |
|---|---|---|
| Voice input on the Otto panel and Otto for Virtual Agent deployments (W5.1) | AIT-P2-W5-voice-mic | Set `voice_input_enabled` back to false on both deployments (Assistant Designer, Configuración) |
| Tools "Get SLA risk facts (AIT)" and "Add autonomous work note (AIT)" | AIT-P2-W4-sla-at-risk | Delete the tools and their 3 agent links |
| Agent "SLA at risk AI agent (AIT)" | AIT-P2-W4-sla-at-risk | **Off switch:** deactivate the trigger; then deactivate the agent |
| Trigger "AIT SLA at risk on DEMO.PI incidents" and its generated flow | AIT-P2-W4-sla-at-risk | Deactivate the trigger (the flow goes with it) |
| SLA definitions "[AIT-TEST] DEMO.PI resolución (12 min)" and "[AIT-TEST] DEMO.PI aviso 75 % (9 min)", breakdown link | AIT-P2-W4-sla-at-risk | Deactivate both definitions |
| Test incidents INC0026068 to INC0026073 | Data | Resolved |
| Test incidents INC0026074 to INC0026078 | Data | Resolve after round 3 |
| B7 rerun: alerts Alert0010116 to Alert0010119, INC0026055 to INC0026057 | Data | Close the alerts, resolve the incidents |
