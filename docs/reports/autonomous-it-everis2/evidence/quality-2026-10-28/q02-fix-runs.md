# Q02 fix: who is on call, and how to reach them (29 October 2026)

Baseline: 7 of 12 (`q02-on-call-baseline.md`). DEMO.PI.SAP had no members and no rota, so the agent
had nothing to read.

## Changes (data, not in an update set)

- **Three fictitious SAP users.** No password, language Spanish, role itil, members of DEMO.PI.SAP,
  with @example.com addresses and +34 600 100 20x numbers:
  - Marta Ruiz (Soporte SAP);
  - Jordi Puig (Soporte SAP);
  - Elena Soto (Responsable SAP).

  Elena is the group manager. The platform created their email devices.
- **Schedule** "SAP 24x7 (Madrid)", Europe/Madrid, daily 00:00-23:59.
- **Rota** "SAP 24x7" for DEMO.PI.SAP, with weekly rosters from 26 October and 30 minutes before
  escalation:
  - Primary: Marta, then Jordi;
  - Secondary: Elena.

  Members must be added with the roster's **Add** dialog: a REST insert of `cmn_rota_member`
  leaves the roster empty.
- **Incident INC0025716**, "[AI-TEST] SAP: error de precios V1 801 ... VA01 (toda la oficina de
  ventas)": P2, DEMO.PI.SAP, caller the persona.
- **Persona role `oc_read`.** Rota ACLs call `OnCallSecurityNG.rotaAccess`. The property
  `com.snc.on_call_rotation.calendar_read_roles` lists `itil`, but the persona, which has `itil`, was
  refused until `oc_read` was added. We didn't trace the exact check.

**Answer key** (`whoisoncall` for DEMO.PI.SAP):

- on call now: Marta Ruiz (Primary);
- next: Elena Soto (Secondary);
- the shift is weekly until Sunday 1 November, then Jordi;
- contact by email or phone.

## Runs (Service Operations Workspace, Otto panel on INC0025716, as the persona)

The question: "¿Quién está de guardia ahora en el grupo de esta incidencia, hasta cuándo, quién es el
siguiente si no responde, y cómo le contacto?"

| Run | Setup | Result | Score |
|---|---|---|---|
| 1 | Persona without `oc_read` | "Requested information could not be retrieved". The trace shows the expert lookup found Marta, then the shift-details tool was refused by the rota ACL. | 2 |
| 2 | With `oc_read` | About 70 s. "**De guardia ahora: Marta Ruiz** (Soporte SAP); Hasta cuándo: No se encontró ese dato; **Siguiente si no responde: Elena Soto** (Responsable SAP); Contacto: email, **+34 600 100 201 / 203**". Correct. The shift end is missing. | 9 |
| 2b | "Sí: asigna INC0025716 a Marta Ruiz y deja una nota de trabajo..." | "No puedo realizar esa solicitud desde este flujo ... solo dispongo de capacidades de consulta en modo lectura". Honest; the assignment stays manual. | n/a |

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2 | 2: the real rota and phone numbers | 1: no shift end | 1: can't assign or page | 2: Spanish | 1: the panel froze, and the answer was read from the transcript | **9 of 12** |

## What's left

- **Shift end:** the tool returns no end time for weekly rosters. Try a daily roster for the demo.
- **Act on it:** assigning or paging needs an agent with a write tool, which is a build decision.
- **Panel freezes:** they happen in long runs; reload the panel if it freezes.

## Revert

- Delete the rota, rosters, members, schedule and span.
- Remove the three users' roles and group memberships, then deactivate the users and their email
  devices.
- Clear the DEMO.PI.SAP manager.
- Remove `oc_read` from the persona.
- Close INC0025716.
