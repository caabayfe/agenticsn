# Q13 baseline: AI governance view (28 October 2026)

Checked in Platform Analytics: "AI Agent Analytics" (OOB, read only) and "Value Dashboard".
Each number on the page is checked against its source table through the REST API.

## Reconciliation

| Dashboard number | Dashboard | Raw table | Match |
|---|---|---|---|
| Manage alerts AI agent executions W43 / W42 / W41 / W40 / W39 | 7 / 10 / 8 / 2 / 9 | `sn_aia_execution_task` with that agent as target, by week: 7 / 10 / 8 / 2 / 9 (one task per plan) | yes |
| Total blocked executions (Security tab) | 81 | `sn_aia_execution_plan` with `state_reason = security_violation`: 81 (the other 13 terminated plans are `execution_failed`) | yes |
| Average inferred CSAT, last 7 days | 3.00 (3.50 this morning) | inferred from conversations, no explicit feedback; not checked | n/a |
| Execution tasks last 7 days, "Ongoing" slice | visible | 65 plans `in_progress` in the last 30 days, none of them moving: stuck runs | yes, and a finding |
| Value Dashboard: Total AI User | 323 | not checked | n/a |
| Value Dashboard: Total Value (Hours), Total Skills Deployed, every reading and writing time widget | "Error" | | broken |

Who runs the alert agent: 40 of 41 runs since 21 September were created by the `admin` account (32
success, 8 cancelled), so they come from automatic alert triggers or another person's tests, not from
operators using it.

## Score

**Answer key:** the sponsor's questions are "who uses AI, what does it save, is it safe, what does it
cost". Usage and safety have reliable numbers; value and cost don't.

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2: the numbers reconcile | 2: from the run tables | 1: blocked runs and errors, no value | 1: no owner or target per number | 1: two dashboards, one broken | 1: CSAT moves on test traffic | **8 of 12** |

## Gaps to fix

- The Value Dashboard: every value widget errors (indicator collection or AI Value setup, R22).
- 65 stuck `in_progress` plans: find the cause and close them, or they inflate "Ongoing".
- The numbers come from test traffic and scheduled triggers; the demo needs persona traffic from this
  plan so the usage story is real.
- The demo page should show one view: usage, blocked runs, errors, inferred CSAT, and (once fixed)
  hours saved.
