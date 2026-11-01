# OOB agents against the builds: same question, same data (29 October 2026)

The question: are the 11 to 12 scores of the builds due to our changes, or is the OOB already that
good? Each build was switched off, the question of its build run was asked again as the same persona
("Analista AIT (ES)", by impersonation), and then everything was switched back on.

**Switched off:** the Otto panel entry (`sys_gen_ai_skill_config.active`) of the workflows B1, B3 and
B8, the tool links of B2 and B3 on the OOB agents, the B6 variable and the B7 business rule. The OOB
agents were not touched. The data, the personas and the overnight configuration stayed on, so this
measures the builds alone. All changes were made in the Default update set and reverted; B1 was rerun
afterwards and answered as before.

Setting a workflow's config override to inactive is **not** enough: the Otto panel still routes to it
and answers "No tiene el acceso necesario". The panel entry is the switch that matters.

| Step | Question | OOB with today's data | Score OOB | Score build |
|---|---|---|---|---|
| Q11 analytics (B1) | "¿Cuántas incidencias se registraron en agosto y en septiembre de 2026, y qué prioridad explica la diferencia entre los dos meses?" | No numbers. An OOB workflow asks which incident numbers to use; the answer says it has no data for those months | ~2 | 11 |
| Q09 status (B2) | "¿Cómo van mis solicitudes e incidencias?" (employee chat) | Lists the 5 tickets with the latest support update for each. Misses the approval by Bow Ruggeri (says "no updates"), the 2 days overdue on RITM0010067, and the resolved INC0025491 counts as open. The action on INC0025715 is only implicit | ~8 | 11 to 12 |
| Q02 on-call (B3) | "¿Quién está de guardia ahora en el grupo de esta incidencia, hasta cuándo, quién es el siguiente si no responde, y cómo le contacto?" (INC0025716) | Marta Ruiz with email and phone, correct. Names Elena Soto (escalation) as next instead of Jordi Puig (next shift). Says it found no shift end | ~9 | 11 |
| Q03 recommend (B8) | "Dame un plan de resolución con evidencias para la INC0026051 a partir de incidencias similares ya resueltas, y dime si está en el grupo correcto." | Plan in the work notes, citing KB0010020, INC0025491, INC0025307, INC0011928, INC0011988, INC0015619 and INC0010743. **Wrong on the group:** "no aparece grupo asignado" while the incident is in DEMO.PI.M365, so no reassignment to Identity. No count of how often each fix worked | ~9 to 10 | 11 to 12 |
| Q08 catalog (B6) | "Quiero pedir Microsoft Visio para mi portátil, lo necesito para dibujar los planos de red de la oficina" (employee chat) | Recommends Visio Pro for Office 365 with approver and delivery time, in Spanish (the B6 translations stay on). Never mentions the user's 2 open Visio requests | ~9 | 11 |
| Q05 alert to incident (B7) | Not rerun: it needs fresh alert events | - | - | 11 |

## What this means

- **Analytics (Q11)** is where the build matters most: the OOB has no way to give exact numbers.
- **Status, on-call, catalog (Q09, Q02, Q08):** with good data, the OOB is already decent (8 to 9).
  The builds add the specific fact that makes the answer useful: the approval and the overdue date,
  the real next person and the shift end, the duplicate request.
- **Recommend (Q03):** the OOB does cite similar incidents **when asked explicitly for evidence**. The
  earlier baseline (7) asked without that wording. The build adds a correct group check and evidence
  counts. The gap is smaller than the baseline suggested.
- Most of the jump from the original baselines (3 to 8) came from the data and configuration of the
  night; the builds take the steps from about 9 to 11 or 12.

Scores are single runs, not the 5-run gate.
