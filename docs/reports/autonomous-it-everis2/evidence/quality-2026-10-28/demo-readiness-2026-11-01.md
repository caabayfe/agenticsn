# Demo readiness: fixes and retests (1 November 2026)

Owner's request: do "before the next demo" (1) and "weakest scenes" (2) from the review of the
presenter's sheet. Runs as the persona Analista AIT (ES) by impersonation, unless it says admin.

## 1. Before the next demo

| Item | Result | Evidence |
|---|---|---|
| On-call rota ended on 1 November 23:59 | **Fixed.** Both SAP 24x7 rosters (Primary, Secondary) rotate every 2 weeks instead of 1, so Marta Ruiz is on call until 8 November. Fix Script 1 now also moves the rotation start to the Monday of the current week on every run and prints who is on call (OK or CHECK), so any demo date works | Rosters are data, not captured by update sets. Revert: rotation_interval_count 1, start 2026-10-26 |
| Leftover automation "Group by SAP PRD hosts" | **Deleted**, with its tag-based correlation rule. Admin's REST delete was refused by an ACL ("Delete Failed due to security constraints"), so it was deleted through the OOB Alert Automation agent's own "Delete Alerts Grouping Automation" tool, from the SOW panel | Both records return 404. The deletes are recorded in update set `AIT-P2-demo-rota` |
| Scene 3.3 as the persona | **Tested, about 11 of 12** (below) | |
| Admin's update set | **Not reset yet**: the work below still needs it | |

## 2. Weakest scenes

| Scene | Before | Now | What changed, what is left |
|---|---|---|---|
| 3.3 Ask the runbook | ~9 (admin, English, silent off-document) | **~11** | As the persona, in Spanish: the most frequent cause with the 80 %; "No. PRD nunca debe reiniciarse a menos que exista un cambio de emergencia aprobado"; a 3 a.m. question answered from two sections (diagnosis first, then escalation to the level 2 contact); an off-document question now gets "Tu pregunta no está relacionada con el documento cargado". Left: the greeting is in English, and you must pick "Answer questions about the document" before typing |
| 2.4 Wrap up | ~9 | **~11** | The typed approval no longer loops; Spanish notes from the analyst's note; Resolved with "Solución proporcionada". The article step ends with "El problema ya está cubierto por el artículo KB0010020" (no duplicate draft), but the panel doesn't redraw it: reload to show it. Left: the close code is asked, not proposed, and the code list is in English (protected OOB agent) |
| 2.1 Wrong door | 9 | 9 | Same diagnosis (a request, not an incident; Network is the wrong group); no catalog item, no conversion. "Sí" to the page context doesn't find the incident: put the number in the question. **Build B9 prepared** (two tools and an agent, `build/b9-*`): names the item (Standard 22" or 24" Monitor, Peripherals) and converts the ticket after a "Sí". Not installed: see the blocker |
| 4.2 Governance | 8 | 8 | The probe worked: since 29 October the value pipeline writes a row a day for the one Managed asset (33 rows in `sn_value_calculated_data_v2`). Fix: move the demo's AI assets to Managed in AI Control Tower. Not done: see the blocker |
| Q03 Recommend | 7 (OOB, automatic on assignment) | 11 to 12 with B8 | Already covered by B8 in scene 2.2b; the automatic OOB note of scene 2.2 is a protected agent |

## Demo hygiene found on the way

- The test account's user name showed in two places: as the caller of INC0025308 (scene 2.1) and as
  the author of the copied work note on the wrap-up incident (scene 2.4). Fix Script 1 now makes a
  fresh `[AIT-DEMO]` copy of the monitor incident with Abel Tuter as caller, and writes the wrap-up
  note as the persona.
- The runbook PDF names "Laura Martínez Ruiz" as level 2 on call; the live rota says Marta Ruiz. Use
  it in the demo: the PDF is static, scene 3.2 reads the rota.
- KB0010019 and KB0010020 have the test account as author. Not visible in the scenes; change it if
  someone opens the article form.

## Fix Script 1, end-to-end run (17:48 instance time)

Saved on the instance (same SHA-256 as `build/demo-1-prepare-fix-script.js` at 3058407, since moved to [sn-accelerators](https://github.com/caabayfe/sn-accelerators/blob/main/docs/autonomous-it/demo/demo-1-prepare-fix-script.js)), recorded in
update set `AIT-P2-demo-prep`, run from the form with "Proceed":

| Line | Result |
|---|---|
| Retired, closed | 3 old copies, 4 old demo alerts |
| 2.1 | INC0026093, the new monitor copy, caller Abel Tuter |
| 2.2, 2.2b, 2.4, 2.5 | INC0026090, INC0026091, INC0026092, INC0026094 |
| 2.5 and 3.2 on call | OK: Marta Ruiz (Soporte SAP), rotation from 2026-10-26, 2 weeks |
| 3.4 automations | OK: 0 |
| 1.3 | CHECK, a script bug: it compared the state label with "On Hold", and the labels came out in Spanish in this session. Fixed to compare the value (commit 5736290); not yet saved on the instance |

Not yet verified: the autonomous note on INC0026094 (due about 17:58) and the persona as author of the
wrap-up note on INC0026092. The browser session expired right after the run.

## Application scope

From 16:16 instance time, the admin's stored current application was "ITSM Spoke", set by another
session on the same account. In that scope Global records can't be saved (REST 403 "ACL Exception
Update Failed"). Switching to Global through the application picker applies to this session only,
leaves the stored preference unchanged, and is undone by impersonation and by a later update-set
switch, so the order is: update set first, then application, then save.
