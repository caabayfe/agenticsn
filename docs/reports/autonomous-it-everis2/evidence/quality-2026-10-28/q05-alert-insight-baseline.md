# Q05 baseline: alert insight (28 October 2026, 21:54)

**Scenario:** event inserted at 21:54 with node `unix200` (a `cmdb_ci_unix_server`): "[AI-TEST]
Filesystem /data at 93% on unix200, grew 20% in the last 6 hours", severity Major, additional info
value 93, threshold 90, growth 20 % in 6 h. The only change on unix200 is CHG0000015 "Unix update",
still in state New (never implemented). No incidents on unix200.

**Answer key:**
- bound to unix200;
- at +20 points in 6 hours (about 3.3 points an hour), the 7 points left fill in **about 2 hours**: the
  key insight and the urgency;
- CHG0000015 is not implemented, so it must **not** be named as the cause;
- next steps: find what is writing to /data, free or extend space before it fills, notify the owner.

**What happened:** Alert0010110, bound to **unix200** (first bound alert in our tests), Open, Major.
"Manage alerts autonomously" wrote an AI summary at 21:55:53, **about 95 s** after the event:
overview (93 %, +20 % in six hours, "may fill if growth continues"), probable cause (rapid data growth:
large files, backups, logs, failed rotation, open-but-deleted files), impact (applications writing to
/data), next steps (list the largest directories and files, ...). It did not mention CHG0000015.

| Criterion | Score | Why |
|---|---|---|
| Correct | 2 | Nothing wrong; it didn't blame the unimplemented change |
| Grounded | 1 | Uses the alert text only: no CI owner, service or history |
| Insight | 1 | Doesn't work out "full in about 2 hours", which drives the urgency |
| Actionable | 1 | Generic Linux steps; no owner, no playbook, no "extend the volume" decision |
| Fit | 1 | Generic; the CI has no service, owner or support group |
| Reliable | 2 | Autonomous, about 95 s |
| **Total** | **8 of 12** | This morning's estimate was "about 9 of 12" |
