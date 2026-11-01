# Q04 baseline: wrap up and resolve (28 October 2026, 22:16-22:22)

Service Operations Workspace, Otto panel, on INC0025307 ("[AI-TEST] No recibo la notificación MFA en
el móvil nuevo"), as the test user.

**Setup, as a technician would leave it:** state In Progress, group DEMO.PI.Identity, assigned to the
test user (who had to be added to the group: it had **0 members**), and a Spanish work note with the
fix: old device removed in My Security Info, Authenticator registered on the new phone with the QR
code, sign-in to Outlook and Teams tested, cause "cambio de dispositivo sin migrar Authenticator",
recommendation "publicar una guía de autoservicio".

**Answer key:** resolution notes taken from the work note (issue, cause, steps, check), in Spanish;
close code "Solution provided" proposed, not asked; no relevant article exists (there's no MFA
article), so the agent should propose one; one approval resolves the incident and creates the draft.

## What happened

1. "Wrap up and resolve this incident": it asked "Can I use the current page context...?" (Yes).
2. **Resolution notes (about 40 s): accurate and well structured, in English.** Issue, cause ("The
   MFA method remained registered on the old device after the phone change") and four steps that
   match the work note, including the aka.ms/mysecurityinfo link.
3. **Approve:** the defect from this morning repeats. The button sends "Approve" and the agent answers
   "If you would like to suggest any changes to the resolution notes, please provide your feedback. If
   you are happy with the notes as they are, you can leave this blank". A blank message can't be
   sent; typing "No changes, apply these notes" continues.
4. **Resolution code:** it lists the codes ("Duplicate, Known error, No resolution provided, Resolved by
   caller, Resolved by change...") with no recommendation. Typed "Solution provided".
5. **Resolved at 22:20:24** (activity "AI, on behalf of" the test user; toast "Check fields generated
   by AI for accuracy"; resolution SLA paused).
6. **Similar articles:** KB0010015 "Outlook Email Synchronization Failure After Office Update",
   KB99999999 "Microsoft Outlook Issues", KB0010002 "Tengo un problema con la VPN". None is about
   MFA.
7. **Draft:** a good 10-step article (problem, root cause, steps), in English.
8. **Create:** "Unable to create knowledge article". The tool output is
   `createKnowledgeArticleStatus: FAILED`, with no reason.

## Cause of the article failure: narrowed, not yet fixed

The tool "Create knowledge article" calls `sn_itsm_aia.IncidentWrapUpUtilSNC.createKnowledgeArticle`,
which (1) checks that the "KB generation" skill is active in product for the incident, (2) parses the
draft, (3) inserts a draft `kb_knowledge` record with `GlideRecordSecure` into the knowledge base
named by `glide.knowman.task_kb` ("Knowledge", active, version 3). It returns FAILED, with no reason,
when the check or the insert fails.

What the trace shows:

- **The skill check passes.** A first reading of the config table (`active = false`) suggested it was
  the cause; that was wrong. AI Admin Hub shows "KB generation" Active, in-product display on,
  available when the incident is Resolved or Closed, which INC0025307 was. The log confirms the code
  went past the check: at 22:22:06 it logged `_extractFieldFromJSON: failed to parse input ...
  Returning raw input` (step 2, harmless) and then evaluated the `kb_knowledge` create ACL (step 3).
- **The insert is refused only inside the agent.** The same insert, with the same fields, as the same
  user, through REST, succeeded (KB0010018, an `[AI-TEST]` probe draft). Cross-scope create on
  `kb_knowledge` is allowed.
- Candidates left: the before-insert rule "Check User CanContribute To Kb" (user criteria evaluated
  in the agent's scoped session), or a create ACL evaluated differently in that scope. Proving which
  one needs a scoped script run or ServiceNow support; fixing either means changing OOB behaviour,
  which needs the owner's approval.

**For the demo:** generate the article from the form ("Generate KB article", the P1-1 path, which
created KB0010015), not from the wrap-up chat.

## Score

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2: notes right, incident resolved | 2: from the work note | 1: no code proposed, irrelevant articles | 1: Approve loop, article fails | 1: English | 1: same defects as the morning run | **8 of 12** |

## Retest as the Spanish persona (23:15-23:25, INC0025491)

**Setup:** a new MFA incident, In Progress, in DEMO.PI.Identity, assigned to the Spanish persona
(added to the group), with the Spanish work note. Three client articles now exist, among them
KB0010020 on MFA with a new phone (see `q07-fix-runs.md`).

**On assignment (Q03, automatic):** "Investigate and recommend" ran without being asked and wrote a
6-step plan in Spanish as a work note, matching the fix. Its only source was "My Security Info" (a
link), not the article number.

**Wrap-up ("Cierra y resuelve esta incidencia"):**

1. It asked, in Spanish, for permission to use the page context (Sí).
2. **One message started two runs, 5 seconds apart.** Their prompts mixed in the panel: one listed
   the resolution codes, the other asked to approve the notes. Choosing "Solution provided" in the
   picker and typing "8" both got "N/A". The panel also stopped updating until the page was
   reloaded.
3. After a reload, "Approve" worked: **the incident is resolved, with the code "Solución
   proporcionada" and these notes, in Spanish:** problem, cause ("El MFA seguía registrado en el
   móvil antiguo tras el cambio de dispositivo") and the four steps from the work note. The
   resolution SLA is paused.
4. Handoff to the knowledge article agent: it called "Fetch similar knowledge articles", then the
   panel stayed on "Processing new information" for over 3 minutes. No article step appeared.

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2: resolved, right notes and code | 2: from the work note | 1: code chosen by the user | 1: article step hangs | 2: Spanish | 1: duplicate runs, panel stops updating | **9 of 12** |

**New finding for Q13:** every conversation this persona had tonight (Q01, Q07, Q03, Q04) is still
an `in_progress` execution plan. Conversations nobody ends stay open, which likely explains most of
the "65 stuck runs".
