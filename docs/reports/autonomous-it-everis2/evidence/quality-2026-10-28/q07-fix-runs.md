# Q07 fix: knowledge answers in the employee chat (28 October 2026, night)

Baseline: 3 of 12 (`q07-q09-employee-baselines.md`). It gave an irrelevant IPv6 answer, in English,
from US university content.

## What was wrong, measured

1. **No client article to find.** The only published VPN article was for Apple devices. The two
   Spanish VPN articles were drafts with placeholder text.
2. **Employees can't read the IT knowledge base.** Its "can read" criteria are the ACME employees
   and two problem groups. Impersonating a normal user showed that, of all published articles, the
   user could read only one: a CIS certifications article. Every Spanish user in the instance is
   in the same situation. The "Knowledge" knowledge base is open to any user.
3. **Language:** answers follow the user's language setting (see `q01-fix-runs.md`, run 6).

## Changes

- Three articles in Spanish, published (each went through the IT approval, approved as admin) and
  then moved to the open "Knowledge" knowledge base:
  - KB0010019 "VPN: no puedo conectarme desde casa con mi portátil Windows";
  - KB0010020 "MFA: registrar Microsoft Authenticator en un móvil nuevo";
  - KB0010021 "SAP: error de precios V1 801 al guardar un pedido de venta (VA01)".
- A persona, "Analista AIT (ES)": language Spanish, no password, roles itil, Otto panel and
  Explain SLA. Tested through admin impersonation.

No user criteria or search profile was changed.

## Runs (Employee Center chat, as the Spanish persona)

| Question | Answer | Score |
|---|---|---|
| "No puedo conectarme a la VPN desde casa con mi portátil Windows, ¿qué hago?" **before** the move to the open knowledge base | In Spanish, but only "use Corp VPN" (a catalog item). It found no article, because the persona couldn't read it. | 5 |
| Same question, **after** the move | Five steps from KB0010019, in Spanish, each with a citation link: check Internet, update the client from the Software Center, approve MFA within 60 s, "credenciales no válidas" handling, open an incident with the exact error. Then "Crear un nuevo incidente" and Corp VPN. Sources: the article. | 11 |
| "He cambiado de móvil y ya no me llegan las notificaciones de MFA" | The cause ("el método sigue registrado en el teléfono antiguo") and the aka.ms/mysecurityinfo steps from KB0010020, in Spanish, cited. | 11 |
| "¿Cómo configuro la impresora de la planta 3 de la oficina de Madrid?" (no article exists) | "No tengo instrucciones de configuración específicas..." It offers "Reparación de equipos de oficina" and "Crear un nuevo incidente". It says honestly that it doesn't know and gives a way forward. | 11 |

Each run scored 2 on correct, grounded, actionable and fit, 2 on insight for the honest "I don't
know", and 1 on reliable (one run each).

## What's left

- The other 7 of the 10 questions, in both languages, and 5 runs per question.
- Check that the article holding a shared secret never appears (the US university content is still
  in the IT knowledge base, which this persona can't read).
- Decide the knowledge base model for the demo. Option 1, used here: client articles go in the open
  "Knowledge" base. Option 2: a client knowledge base with its own criteria.
- The steps don't use the user's own device yet ("from their assigned laptop" in the target).

**Status:** Q07 went from 3 to about 11 of 12 on three questions. The causes were content and access,
not the AI.
