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

## Root cause of the article failure (found tonight)

The tool "Create knowledge article" calls `sn_itsm_aia.IncidentWrapUpUtilSNC.createKnowledgeArticle`.
It inserts the article only if `sn_km_gen_ai.KnowledgeGenAIUtils.isSkillActiveForInProduct` is true
for the incident, and that reads the Now Assist skill configuration "KB generation" (4a115761...),
which on everis2 is **active = false, in-product active = false** (roles itil,
sn_service_desk_agent). The target knowledge base (`glide.knowman.task_kb`, "Knowledge") exists and
is active. P1-1 created KB0010015 through the author path, which doesn't check this flag. **Fix:
activate "KB generation" for incidents in Now Assist Admin** (a class A activation), then retest.

## Score

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2: notes right, incident resolved | 2: from the work note | 1: no code proposed, irrelevant articles | 1: Approve loop, article fails | 1: English | 1: same defects as the morning run | **8 of 12** |
