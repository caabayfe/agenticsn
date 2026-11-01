# Demo route: the records, in the order of the storyline

The short version of [the demo script](08-demo-script.md): which record to open at each beat, and
what to show on it. It follows the storyline "one working day, one rung higher on the autonomy ladder
at each act".

## The day before: run one Fix Script

1. As admin: **System Definition → Fix Scripts → "AIT demo 1 - prepare (day before)" → Run Fix
   Script → Proceed**. It takes about 10 seconds.
2. Read the last lines of the output (scroll to the bottom of the window). It lists the demo route
   below, with **today's numbers** for the fresh records, and `OK` or `CHECK` on each one.
3. Write down the four new numbers (scenes 2.2, 2.2b, 2.4 and 2.5). The route below shows the numbers
   of the run on 30 October as an example.
4. Fix any `CHECK` line. The usual one is 3.4: delete the grouping automation "Group by SAP PRD hosts"
   left by the last demo (Event Management → Alert grouping automations), or the AI proposes a
   duplicate.

What the script does ([source](build/demo-1-prepare-fix-script.js), update set `AIT-P2-demo-prep`):

| Step | Records | Why |
|---|---|---|
| Retire the last demo's copies | `[AIT-DEMO]` and `[AIT-P1]` incidents still New, In Progress or On Hold are resolved | The queues stay clean between demos |
| Fresh MFA incidents | Copies of INC0025307 (in Network), INC0026051 (in M365) and INC0025491 (In Progress, assigned to the persona, with the analyst's Spanish note), caller Abel Tuter | Scenes 2.2, 2.2b and 2.4 use them up. The persona's own list doesn't change |
| Reset the on-call incident | INC0025716: DEMO.PI.SAP, unassigned, New | Scene 3.2 assigns it |
| SAP outage | Closes the old demo alerts, moves CHG0030111 to 80 minutes before now, sends the three SAP events again | Scene 3.1: new grouped alerts with AI notes that cite the kernel change |
| The autonomous SLA note | An `[AIT-P1]` incident in Workplace, moved to SAP 3 minutes later | Scene 2.5: the note is there the next day |
| Check the rest | KB, requests, SLA history, trigger, persona tickets, automations | One `CHECK` line for anything a past demo changed |

It changes no configuration and is safe to run twice; each run makes new copies. For a live scene 2.5,
run **"AIT demo 2 - start SLA clock (live)"** at the start of Act 2 instead; the note arrives about
9.5 minutes later ([source](build/demo-2-start-sla-clock-fix-script.js)).

## The route

Instance: `everisspainsludemo2.service-now.com`. SOW means Service Operations Workspace
(`/now/sow/record/<table>/<sys_id>`); ESC means the Employee Center chat (`/esc?id=ai_native_chat`).
Impersonate **Analista AIT (ES)** except where it says admin.

```mermaid
flowchart LR
  subgraph A1["Act 1 · employee · level 0-2"]
    KB["KB0010019<br/>VPN answer"] --> VIS["RITM0010067/68<br/>Visio request"] --> ST["INC0025715<br/>my status"]
  end
  subgraph A2["Act 2 · service desk · level 1-3"]
    MON["INC0025308<br/>wrong door"] --> REC["MFA copy in Network<br/>recommendation"] --> WG["MFA copy in M365<br/>plan + right group"] --> SLA["INC0010147<br/>why the SLA broke"] --> WR["MFA copy In Progress<br/>wrap up"] --> P1["[AIT-P1] incident<br/>autonomous note"]
  end
  subgraph A3["Act 3 · operations · level 2-3"]
    AL["Newest SAP alert group<br/>+ CHG0030111"] --> OC["INC0025716<br/>on call + hand-over"] --> RB["INC0025194<br/>runbook PDF"] --> AU["SAP alert<br/>automation in words"]
  end
  subgraph A4["Act 4 · management"]
    AN["Analytics chat"] --> GOV["AI Agent Analytics"]
  end
  A1 --> A2 --> A3 --> A4
```

| # | Where | Record (30 Oct run) | Do | Show |
|---|---|---|---|---|
| 1.1 | ESC chat | KB0010019 (`kb_knowledge` 296be998…7b9b) | Ask the VPN question | Five steps from the article, each with its source |
| 1.2 | ESC chat | RITM0010067, RITM0010068 | Ask for Visio | The laptop chips, and the warning that she already has two Visio requests |
| 1.3 | ESC chat | INC0025715, RITM0010068, RITM0010067 | "¿Cómo van mis solicitudes e incidencias?" | What she must answer (INC0025715), who must approve (RITM0010068), what is late (RITM0010067) |
| 2.1 | SOW | INC0025308 (d10d555c…7b02) | "¿Esta incidencia es realmente una incidencia?" | It is a request in disguise |
| 2.2 | SOW | **MFA copy in Network** (INC0026085) | Assign it to DEMO.PI.Identity and the persona | Within a minute, the "Investigate and recommend" plan appears as a note |
| 2.2b | SOW | **MFA copy in M365** (INC0026086) | Ask for the plan with evidence and the group | Steps that cite resolved incidents, and "reasignar a DEMO.PI.Identity" (6 to 0) |
| 2.3 | SOW | INC0010147 (d13e9ef9…7beb) | "¿Por qué se ha incumplido el SLA?" | Database held it 48 days; the other groups are not the cause |
| 2.4 | SOW | **MFA copy In Progress** (INC0026087) | "Cierra y resuelve esta incidencia" | Close notes in Spanish from the analyst's note; Resolved |
| **2.5** | SOW | **`[AIT-P1]` incident** (INC0026088) | Open it; don't use the panel | The note `[AIT auto · SLA en riesgo]`: risk, cause (nobody owns it, 3 min lost in Workplace), on call Marta Ruiz, next step. **Nobody asked** |
| 3.1 | SOW, admin | Newest alert group on SAP AppSRV01 (Alert0010124), CHG0030111 (dd9c97d4…7b8f) | Open the group, then the primary alert | Three grouped alerts, the AI cause "kernel 7.89 PL 200" from the change, then Quick Incident with the analysis in the note |
| 3.2 | SOW | INC0025716 (b5ca9f10…7bfc) | Ask who is on call; then "Asigna esta incidencia a la persona de guardia…" | Marta Ruiz until 1 Nov, then Jordi, escalation Elena; assigned after two "Sí" |
| 3.3 | SOW | INC0025194, attachment Runbook_SAP_SD-OPS-017_V1-801.pdf | Document Viewer → Ask Otto | The most common cause (80 %) and "never restart PRD without an emergency change" |
| 3.4 | SOW, admin | A SAP alert of 3.1 | Describe the grouping rule in words | The automation, created inactive |
| 4.1 | SOW chat | – | The two analytics questions, each in a new chat | Stacked chart, then 843 against 895, P4 explains 73 % |
| 4.2 | Platform Analytics, admin | AI Agent Analytics | – | Runs, blocked runs and errors; every number matches the tables |

**Shorter demo (20 minutes):** 1.1, 1.3, 2.2b, 2.3, **2.5**, 3.1, 3.2. It keeps one scene per rung of the
ladder and the autonomous note as the turn.

## Presenter's sheet: use case, user, what to type, what to expect

Start a **new chat** for each row. Type "Sí" or "No" instead of clicking the confirmation buttons. If
the panel stays on "Processing", reload the page; the answer is usually already there. The numbers are
those of the 30 October run; use the ones the Fix Script prints.

| # | Use case | Where / record | User | Type this | Expected outcome |
|---|---|---|---|---|---|
| 1.1 | Answer from the knowledge base | Employee Center chat | Analista AIT (ES) | `No puedo conectarme a la VPN desde casa con mi portátil Windows, ¿qué hago?` | Five steps from KB0010019 in Spanish, each with a source link, then "Crear un nuevo incidente" |
| 1.2 | Request software | Employee Center chat | Analista AIT (ES) | `Quiero pedir Microsoft Visio para mi portátil, lo necesito para dibujar los planos de red de la oficina`, then pick PC-AIT-ES-01 | Visio recommended, the reason filled in from the sentence, her two laptops as chips, and the warning that RITM0010068 is already pending approval |
| 1.3a | Status of one request | Employee Center chat | Analista AIT (ES) | `¿Qué pasa con mi solicitud RITM0010067? ¿Por qué tarda tanto?` | It waits for the vendor licence (from the fulfiller's comment), with the history |
| 1.3b | Overview of my tickets | Employee Center chat, new chat | Analista AIT (ES) | `¿Cómo van mis solicitudes e incidencias?` | INC0025715 needs her answer (VPN client version, cable or not); RITM0010068 waits for Bow Ruggeri's approval; RITM0010067 is 2 days late |
| 2.1 | The wrong door | SOW, `[AIT-DEMO]` monitor copy (the number the Fix Script prints) | Analista AIT (ES) | `¿La incidencia <número> es realmente una incidencia? ¿Qué debo hacer con ella?` (the number in the question: "Sí" to the page context doesn't find it) | "No parece ser realmente una incidencia": a monitor request while the current one works, and Network is the wrong group; reclassify it as a request |
| 2.2 | Recommendation nobody asked for | SOW, MFA copy in Network (INC0026085) | Analista AIT (ES) | Nothing: assign it to DEMO.PI.Identity and to the persona | Within about a minute, a work note "Investigate and recommend" with a plan in Spanish |
| 2.2b | Plan with evidence, right group | SOW, MFA copy in M365 (INC0026086) | Analista AIT (ES) | `Dame un plan de resolución con evidencias para esta incidencia a partir de incidencias similares ya resueltas, y dime si está en el grupo correcto.` | Steps that cite resolved incidents, and "reasignar a DEMO.PI.Identity" (6 similar incidents resolved there, 0 in M365) |
| 2.3 | Why the SLA breached | SOW, INC0010147 | Analista AIT (ES) | `¿Por qué se ha incumplido el SLA de esta incidencia?` | P2 resolution SLA breached on 1 May; Database held it 48 days 16 hours, the other groups seconds ("no son la causa"); a timeline and a next action |
| 2.4 | Wrap up and resolve | SOW, MFA copy In Progress (INC0026087) | Analista AIT (ES) | `Cierra y resuelve esta incidencia`, `Sí`, `Apruebo las notas, sin cambios`, then `Solution provided` | Spanish close notes from the analyst's note; Resolved with "Solución proporcionada"; then "El problema ya está cubierto por el artículo KB0010020" (reload the panel if it stops at "Artículos de conocimiento similares") |
| **2.5** | **The SLA nobody watched (level 3)** | SOW, `[AIT-P1]` incident (INC0026088) | Analista AIT (ES) | Nothing: open it | Note `[AIT auto · SLA en riesgo]` by the persona: SLA at 75 % and minutes left; cause (nobody owns it, no update for 9 min, 3 min lost in Workplace); on call Marta Ruiz, escalation Elena Soto; next step, assign it to Marta and call her |
| 3.1 | Alerts that explain themselves | SOW, newest SAP alert group (Alert0010124) and CHG0030111 | admin | Nothing: open the group, the primary alert, then Quick Incident | Three alerts grouped and routed to DEMO.PI.SAP; AI cause "kernel 7.89 PL 200" from the change; the new incident has the CI, the group and the analysis |
| 3.2a | Who is on call | SOW, INC0025716 | Analista AIT (ES) | `¿Quién está de guardia ahora en el grupo de esta incidencia, hasta cuándo, quién es el siguiente si no responde, y cómo le contacto?`, then `Sí` | Marta Ruiz until the Sunday after next, 23:59 (the Fix Script restarts the 2-week rotation each Monday), then Jordi Puig; escalation Elena Soto; phones and emails |
| 3.2b | Hand it over | SOW, INC0025716, new chat | Analista AIT (ES) | `Asigna esta incidencia a la persona de guardia y deja una nota de trabajo: revisar primero el transporte de condiciones de precios`, then `Sí` twice | Assigned to Marta Ruiz, In Progress, with the work note |
| 3.3 | Ask the runbook | INC0025194, Runbook_SAP_SD-OPS-017_V1-801.pdf, Document Viewer, Pregunte a Otto | Analista AIT (ES) | First pick "Answer questions about the document", then `¿Cuál es la causa más frecuente del error V1 801?`, `¿Puedo reiniciar PRD para arreglarlo?` and `Son las 3 de la mañana y el error V1 801 está pasando ahora. ¿Qué reviso primero y a quién llamo si no lo resuelvo en 20 minutos?` | The price-conditions transport (80 %); "No… sin un cambio de emergencia aprobado por el CAB"; the three checks, then the level 2 contact. The PDF names Laura Martínez Ruiz, the live rota Marta Ruiz: "the document is static, 3.2 reads the rota" |
| 3.4 | Make it automatic next time | SOW, a SAP alert of 3.1 | admin | `Create an alert grouping automation so that future alerts on the SAP PRD hosts (SAP AppSRV01, SAP AppSRV02, SAP LoadBal01, SAP WEB01 to WEB04) that happen within 30 minutes of each other are grouped into one, even when the CIs are not related. Show me the proposal first and keep it inactive.`, then `Yes, create it inactive` | The proposal (seven hosts, 30 minutes), then the automation created inactive ("View automation") |
| 4.1a | A chart from a question | SOW chat, new chat | Analista AIT (ES) | `Compara en un gráfico de columnas apiladas las incidencias registradas en agosto y en septiembre de 2026, por mes y por prioridad` | A stacked column chart by month and priority |
| 4.1b | The numbers behind it | SOW chat, new chat | Analista AIT (ES) | `¿Cuántas incidencias se registraron en agosto y en septiembre de 2026, y qué prioridad explica la diferencia entre los dos meses?` | 843 against 895; P4 explains 73 % of the difference |
| 4.2 | Governance | Platform Analytics, AI Agent Analytics | admin | Nothing | Runs, blocked runs and errors per agent; every number matches the tables |

Before 3.4, delete the automation "Group by SAP PRD hosts" (Event Management → Alert grouping
automations), or the AI proposes a duplicate. For a live 2.5, run "AIT demo 2 - start SLA clock
(live)" as admin at the start of Act 2 and open the incident it prints about 9.5 minutes later.

## Tested on 30 October 2026

Run from the Fix Script form as admin at 10:31 (instance time), with "Proceed":

| Check | Result |
|---|---|
| Output | All lines `OK` except 3.4 (the Q06 automation "Group by SAP PRD hosts" is still there) |
| Copies | INC0026085 (Network), INC0026086 (M365), INC0026087 (In Progress, persona, the analyst's Spanish note); caller Abel Tuter |
| SAP outage | Alerts Alert0010122 and Alert0010123 grouped under Alert0010124 within 10 s; the AI summary at 10:33:40 names "a kernel update and instance restart" |
| Hand-off | The scheduled job moved INC0026088 to DEMO.PI.SAP at 10:34:56 (reassignment count 1) |
| Autonomous note | At 10:41:26 on INC0026088, by Analista AIT (ES): "nadie lo tiene asignado; sin actualizaciones desde hace 9 min; pasó 3 min en DEMO.PI.Workplace antes de llegar a DEMO.PI.SAP", on call Marta Ruiz with the escalation to Elena Soto, "asignarlo ahora a Marta Ruiz y llamarla" |
| Persona tickets | 4 open (INC0025715, INC0025716, RITM0010067, RITM0010068) |

The first draft retired every active `[AIT-P1]` incident, including resolved ones, so it rewrote the
close notes of the pilot test incidents INC0026068 to INC0026084 (their work notes, the evidence, are
unchanged). The script now retires only New, In Progress and On Hold copies.

**Revert:** delete the two Fix Scripts (update set `AIT-P2-demo-prep`). The demo records are data,
retired by the next run.

## After the demo

The next run of the Fix Script retires the copies and resets INC0025716. Only one thing is manual:
delete the automation that scene 3.4 created, before the next demo (the script flags it with `CHECK`).
