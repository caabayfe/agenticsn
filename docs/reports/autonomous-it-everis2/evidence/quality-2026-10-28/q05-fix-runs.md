# Q05 fix: alert insight on CIs with an owner and a change (29 October 2026)

Baseline: 8 of 12 (`q05-alert-insight-baseline.md`). The baseline CI, unix200, had no owner, service or
history, so the AI could only repeat the alert text.

## What was wrong

The SAP CIs used in the demo story had no support group and no owner, and no change had touched
them. In that state, "Manage alerts autonomously" has nothing to correlate with.

## Changes (data only)

- **CIs:** SAP AppSRV01, SAP AppSRV02 and SAP LoadBal01 now have support group DEMO.PI.SAP and owner
  Elena Soto (a fictitious SAP lead). The CMDB relationships already existed: SAP WEB01 to WEB04
  depend on AppSRV01 and AppSRV02, and LoadBal01 serves the SAP services, among them SAP Sales and
  Distribution.
- **Change:** CHG0030111 "[AI-TEST] Actualización del kernel SAP a 7.89 PL 200 en SAP AppSRV01", on
  AppSRV01. It is normal and implemented 80 minutes before the events, and closed as successful. Its
  approvals were approved as admin.
- **Events (source AIT-Demo), sent at 06:24 UTC:**
  1. `/usr/sap/PRD/DVEBMGS00/work` at 92 % on AppSRV01, up 18 points in 3 hours (Major);
  2. 14 dialog work process restarts in 30 minutes on AppSRV01, with DBSQL_SQL_ERROR dumps and SD
     transactions timing out (Critical);
  3. the LoadBal01 pool `sap_web_https` has 2 of 4 members up (WEB03 and WEB04 failing), with 9 % of
     HTTPS requests failing (Major).

## Answer key

| Alert | A top answer |
|---|---|
| Filesystem | At about 6 points an hour, the 8 points left fill in **about 80 minutes**. The work directory holds traces and dumps, so this is linked to alert 2. Free or extend space now. Owner DEMO.PI.SAP. |
| Work processes | **Started after CHG0030111** (kernel 7.89 PL 200, about 1 h earlier): the probable cause. Check ST22 and dev_w traces, check the DB library of the new kernel, and roll back if confirmed. Impact: SD users. |
| Load balancer | WEB03 and WEB04 fail behind the load balancer, which is not the cause itself. The web servers depend on AppSRV01 and AppSRV02, so look at alert 2 first. Impact: SAP web services. |

## What happened

Within 2 seconds, each alert was **bound to its CI** (Alert0010111 and Alert0010112 on AppSRV01,
Alert0010113 on LoadBal01). Each was **assigned to DEMO.PI.SAP** from the CI's support group.

At 06:24:32, OOB automation "Group alerts with CI relationships" put the three into **one group,
Alert0010114**, with the work-process alert as primary ("the oldest of the highest severity
alerts").

From 06:24:39 to 06:25:43, "Manage alerts autonomously" wrote three AI notes on each alert: analysis,
investigation and summary, the last about 100 s after the event.

| Alert | What the AI said | Score |
|---|---|---|
| Work processes (#2) | Probable cause: **"regression or incompatibility from the recent SAP kernel upgrade 7.89 PL 200"**, "timing correlates directly with the start of dialog work process restarts". Next steps: ST22, dev_w and dev_disp, compare profile parameters with the baseline, **roll back to the prior kernel** if confirmed, check SAP Notes for the patch. Impact: SD transactions. Contact: "SAP Basis, DBA, infrastructure", not DEMO.PI.SAP. | 11 |
| Filesystem (#1) | It links the growth to the kernel update and restart (traces, dumps), gives commands for the right directory, then housekeeping, an LVM extend and "Contact: DEMO.PI.SAP". It still **doesn't work out "full in about 80 minutes"**, and it doesn't link to the dumps of alert 2. | 10 |
| Load balancer (#3) | Correct summary (2 of 4, WEB03 and WEB04, 9 %), and it names the kernel change on AppSRV01. But it suggests "if the recently updated server is one of the unhealthy members", and **AppSRV01 isn't a pool member**: the real path is that the web servers depend on AppSRV01. Generic TLS and firewall checks. "Contact: DEMO.PI.SAP". | 9 |

| Criterion | Score | Why |
|---|---|---|
| Correct | 2 | The change is the cause for #2 and plausible for #1; #3 is half right |
| Grounded | 2 | Uses the CI, the change (version, time) and the support group |
| Insight | 1 | Change correlation and grouping are strong, but no time to full and no WEB-on-AppSRV dependency |
| Actionable | 2 | Rollback, ST22, extend, contact group |
| Fit | 1 | English (it runs as the system, not as a user). It doesn't name the owner. |
| Reliable | 2 | Autonomous, all three in about 100 s |
| **Total** | **10 of 12** | Baseline 8 |

## Gaps left

- **Language:** autonomous notes follow the system language (English). Making the notes Spanish
  needs the agent's instructions or the system language changed. That is an owner decision.
- **Time to full:** add an instruction to the alert analysis ("when the alert gives a growth rate,
  estimate when the threshold or 100 % is reached"). This needs a copy of the OOB agent, as was done
  for Q01.
- **Topology reasoning:** it reads the change on related CIs but not the dependency direction.
- **Change number:** it describes the change but doesn't quote CHG0030111.
- **Repeat:** one run so far, against a target of 5 of 5.

## For the demo

Send the three events (the payloads are above) 60 to 90 minutes after closing the change. Show the
group Alert0010114, then the primary alert's summary, which names the kernel change and the
rollback.

## Revert

- On the three CIs, clear support group and owner (they were empty).
- Cancel CHG0030111 (dd9c97d4...).
- Close alerts Alert0010111 to Alert0010114 and the AIT-Demo events.
