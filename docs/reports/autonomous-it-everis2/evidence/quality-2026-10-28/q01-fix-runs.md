# Q01 fix: SLA explainer, runs after each change (28 October 2026, night)

Baseline: see `q01-sla-baseline.md`. All runs are in the Service Operations Workspace Otto panel, as
the test user (admin, language English).

## Changes

All in the Global update set `AIT-Q01-sla-explain-sla`, except the SLA links (data, see change 3).

1. **Copy of the OOB "Explain SLA" workflow, "Explain SLA (AIT)".** The OOB workflow is a protected
   template, so it can't be edited. The copy has a broader description (so the panel routes SLA
   questions to it) and the Otto panel channel on. Its plan asks for a direct answer with three lines:
   "Main cause", "Silence" and "Next action", plus a short timeline, in the user's language.
2. **Copy of the "Explain SLA" agent, with two instruction changes:**
   - skip the 12-question menu when the user already asked a question;
   - finish with Main cause, Silence and Next action.

   It runs as the user, with role itil.
3. **SLA breakdown links.** Only "Priority 1 resolution" and "Priority 2 resolution" were linked to
   the breakdown definition "Incident SLAs by Assignment", so for every other SLA the agent saw no
   time per group. These 8 definitions are now linked:
   - Network group resolution;
   - P1 response and P2 response;
   - P3 response and P3 resolution;
   - P4 response and P4 resolution;
   - P5 response.

   These rows are data and weren't captured in the update set. The revert list names them.

The links apply to SLAs that start after the change. Existing SLAs get no breakdown, so the demo
incidents must be created after this change.

## Runs

| Run | Incident and question | After change | Result | Score |
|---|---|---|---|---|
| 1 | INC0010147, "why did the SLA breach?" | 1 | Routed to the copy, but showed the 12-question menu first. After a choice, the cause was right: Database group, Beth Anglin, 48 d 16 h. | about 7 |
| 2 | INC0010147, same question | 1, 2 | Direct answer, with the right cause: "other reassignments lasted only seconds, so they were not the cause". Next action: "Ask the Database group for an immediate status update today and escalate to the group manager". The Silence line said "not available in SLA data". | about 10 |
| 3 | INC0010147, question in Spanish | 1, 2 | Same correct content, **in English**. The user record's language wins over the instruction. | about 9 |
| 4 | INC0025306 (P4, unassigned, at risk), "is the SLA at risk?" | 1, 2 | It picked "Priority 4 response (8 hours)" as likely to breach, with 86.75 % of business time used and 1 h 3 min left. **This is correct**: the answer key first used `percentage` instead of `business_percentage`. Gaps: it gave no breakdown (the definition wasn't linked), "ask the current assignee" on an unassigned incident, and it missed that the Network group resolution SLA had already breached. | about 9 |
| 5 | INC0025490 (new P3 probe, Network then Database), "which group has used the time so far?" | 1, 2, 3 | It reads the breakdown: "Database and Network, both at 0 seconds (0 %)", which is correct (it is outside business hours). It said 4 hours remaining, no threshold crossed, and that no group was the cause yet. The next action said "the currently assigned group", not "Database". | about 10 |
| 6 | INC0010147, "¿Por qué se ha incumplido el SLA de esta incidencia?", **as a Spanish persona** (admin impersonation; user language Spanish, roles itil, Otto panel and Explain SLA) | 1, 2, 3 | **Whole answer in Spanish**: P2 resolution SLA, breached on 1 May 08:44. Database / Beth Anglin held it for 48 d 16 h. Service Desk 48 s, Hardware, Network and Software 10 s each: "no son la causa". It says honestly that it has no work-note data, then gives a short timeline. | about 11 |

Run 6 shows that the language comes from the **user's language setting**, not from the question or
the instructions. The test user is English, so every earlier run answered in English. The demo must
run as a Spanish persona; this applies to every step, not only Q01.

## What's left

- **Silence:** the agent has no work-note data. Add a tool that reads the last work note or comment
  and the time since, or accept "not available".
- **Other SLAs:** it explains one SLA, picked by "breach first". A breached sibling SLA should be
  mentioned.
- **Unassigned and group names:** the next action should name the group, and should say "assign it
  now" when nobody owns the incident.
- **A breach story with breakdown:** demo scenario (a) needs an incident whose SLA breached after
  hand-offs between groups. That takes real elapsed business time, so create it the day before the
  demo, or use INC0010147, whose P1 SLA has a breakdown.

**Status:** Q01 went from 3 (a confident wrong cause) to about 10 of 12 in English and 11 in Spanish
as a Spanish persona. It isn't top quality yet: there's no silence data, and only one run per scenario
has been done, against a target of 5 of 5.
