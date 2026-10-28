# Q03 baseline: recommend a resolution (28 October 2026, 21:51)

## Scenario and answer key

Test incident **INC0025307**, created for this test: "[AI-TEST] No recibo la notificación MFA en el
móvil nuevo". Description (Spanish): changed phone yesterday, no Microsoft Authenticator notification
since, can't reach mail from the laptop.

Answer key, from the 9 resolved incidents "No recibo la notificación MFA" of the last 180 days
(INC0012261, INC0022439, INC0016564, INC0014782, INC0021894, INC0014566, INC0010592, ...):
- fix: re-register Microsoft Authenticator, reset the MFA registration, or remove old MFA methods and
  set up a new one (the new-phone detail points to the last two);
- group: DEMO.PI.Identity (8 of 9); the assignment rule sent INC0025307 to **Network**, which is wrong;
- no knowledge article exists on MFA.

A top answer: the steps above, in Spanish, citing a few of the similar incidents ("resolved 9 times
in 6 months the same way"), and recommending reassignment to DEMO.PI.Identity.

## What happened

"Recommend a resolution for INC0025307" in the SOW panel ran **Investigate and recommend incident
resolution** (Completed, 21:51:51 to 21:52:45, 54 s) and wrote an 8-step plan as a work note:

> 1. Confirm the user changed to a new mobile device ... 3. Review the user's existing MFA registration
> and identify any old or inactive mobile authentication methods ... 4. Remove outdated MFA methods
> linked to the previous device ... 5. Reset or re-register the user's Microsoft Authenticator
> enrollment for the new mobile device ... 7. Ask the user to complete a fresh sign-in ... 8. If
> notifications still do not appear, validate whether an alternative MFA method can be used
> temporarily ...

Trace (`sn_aia_execution_task`): "Fetch all data" returned 10 similar resolved incidents, including
the relevant INC0012261, INC0014529 and INC0010743, and no knowledge articles. The next tool was
`organize_general_knowledge`. The plan cites no incident.

## Score

| Criterion | Score | Why |
|---|---|---|
| Correct | 2 | Matches the key's fixes, and uses the new-phone detail |
| Grounded | 1 | Similar incidents were retrieved but not cited; the user can't see that it is a known case |
| Insight | 1 | Doesn't say this happened 9 times in 6 months, or that the group is wrong |
| Actionable | 1 | Clear steps for the agent, but no reassignment to DEMO.PI.Identity and no reply to the caller |
| Fit | 0 | English, for a Spanish incident and caller |
| Reliable | 2 | Completed first time in 54 s (this morning's first run failed: retest 5 times) |
| **Total** | **7 of 12** | This morning's estimate was "about 8 of 12" |
