# Q08 and Q09 fixes: request software, and status of my requests (29 October 2026)

Baselines: Q08 7 of 12 and Q09 6 of 12 (`q07-q09-employee-baselines.md`). All runs below are in the
Employee Center chat (`/esc?id=ai_native_chat`), as the Spanish persona (admin impersonation).

## Q08 Request software

**Answer key:** one recommendation, the right item (Microsoft Visio). Ask why and for which device,
reusing what the user already said. Mention approval and delivery. Spot that the user already has an
open request for the same item.

### Run 1, before the fix: about 8

"Quiero pedir Microsoft Visio...":

1. Spanish; two options (Visio Pro and "Instalar software"), each with an explanation.
2. "1" gave an empty confirmation card, then Enviar.
3. REQ0010069 / RITM0010067 Visio was created: approved, Fulfillment, due 31 Oct.

The reason the user gave was lost. It didn't ask about a device and said nothing about approval.

### Changes (update set `AIT-Q08-Q09-request-catalog`, Global)

- Variable `ait_motivo` on the Visio item: multi-line, mandatory, "¿Para qué necesitas Visio?".
- Variable `ait_equipo` on the Visio item: a reference to `cmdb_ci_computer`, mandatory, "¿En qué
  equipo lo instalamos?". The qualifier is the simple "assigned to is (dynamic) Me".
  - An advanced `javascript:` qualifier made the agent answer "no hay opciones" (run 2).
- Data: two laptops assigned to the persona, "PC-AIT-ES-01 (portátil Windows 11)" and "PC-AIT-ES-02
  (portátil de pruebas)".

### Run 3, after the fix: about 10

"Quiero pedir Microsoft Visio para mi portátil, lo necesito para dibujar los planos de red de la
oficina":

1. **One recommendation**: Visio, with the user's reason quoted.
2. Iniciar solicitud: the **reason is prefilled** from the sentence: "Dibujar los planos de red de la
   oficina".
3. Sí, continuar: "¿en qué equipo lo instalamos?", with chips **PC-AIT-ES-01** and **PC-AIT-ES-02**.
4. A summary card, then Enviar: **RITM0010068**, with both answers stored.

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2 | 2: the user's own laptops | 1: missed the duplicate (RITM0010067 is open for the same item) | 2: request created with everything fulfilment needs | 1: the card shows the item's English marketing short description | 2 | **10 of 12** |

**Open:** the item's short description can't be changed. The field is read-only on the form, and a REST
PATCH returns 200 but the value doesn't change (protected catalog item). The fix is a copy of the item
with a Spanish description, and the copy goes in the update set.

## Q09 Status of my requests

**Answer key**, data built for it:

| Record | State | What a top answer says |
|---|---|---|
| RITM0010068 Visio | **Waiting for approval** from the manager (Bow Ruggeri) | "Pending your manager's approval" |
| RITM0010067 Visio | Assigned to Beth Anglin (Software). **Due 27 Oct, overdue.** Customer comment: waiting for the vendor licence | "Late since 27 Oct, waiting for the licence" |
| INC0025715 VPN | **On hold, waiting for the caller**. The comment asks for the VPN client version and a cable test | "**You** need to answer: send the version and test the cable" |
| INC0025491 MFA | Resolved | Nothing to do |

### Run 2, overview: about 5

"¿Cómo van mis solicitudes e incidencias?" listed all four with their states. The RITMs showed the
marketing description.

The follow-up "¿Qué está bloqueado, desde cuándo, y hay algo que tenga que hacer yo?" named only
INC0025715 "En espera". It then said **"no se indica ninguna acción pendiente por tu parte"**, which is
wrong. It missed the pending approval and the overdue request.

### Runs 3 and 4, one ticket at a time: about 9

- "INC0025715": "El equipo de Network dejó el ticket en espera mientras solicita dos datos ...
  **Actualmente están pendientes de tu respuesta.**" Correct.
  - The UI stayed on "Obteniendo la última actualización"; the answer is in the transcript.
  - Another run showed an empty bubble although the transcript had the answer (a rendering defect).
- "¿Qué pasa con mi solicitud RITM0010067? ¿Por qué tarda tanto?": Spanish, and the reason is right
  (waiting for the vendor licence, from the comment). Gaps:
  - it doesn't say it has been overdue since 27 Oct;
  - the action buttons are in English ("Add an attachment / Add a comment");
  - it shows the comment's author. In the demo, comments must come from a fulfiller persona, not the
    admin test user.

### Conclusion

- The overview tool reads **state only**.
- The per-ticket tool ("Get last update or details on ticket") summarizes **customer-visible
  comments** well.
- Neither reads the approval or the due date.

For the demo:

- ask per ticket;
- make sure fulfillers write customer-visible comments that say what they wait for.

The fix for the overview is a copy of the status agent with a tool that adds the approval state, the
due date and "waiting for caller", which is a build decision.

| Mode | Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|---|
| Overview | 1 | 1 | 0 | 1 | 1 | 1 | **5** |
| Per ticket | 2 | 2 | 1 | 2 | 1 | 1 | **9** |

## Revert

- Back out update set `AIT-Q08-Q09-request-catalog`.
- Retire the two laptops.
- Cancel REQ0010069 / RITM0010067 and RITM0010068, and their approval.
- Close INC0025715.
- Set INC0025491's caller back to the test user.
- Clear the persona's manager.
