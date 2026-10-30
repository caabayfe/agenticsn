# Q13 fix: why the Value Dashboard shows "Error" (29 October 2026)

Baseline: 8 of 12 (`q13-governance-baseline.md`). Usage and safety reconcile, but every value widget
shows "Error".

## Root cause, in two layers

1. **The dashboard reads a table that no longer exists.** "Value Dashboard" (app "Value dashboard for
   AI Control Tower") builds its widgets on the data source "Value Calculated Data", table
   `sn_value_calculated_data`. That table isn't on the instance ("Invalid table"). The Value apps were
   upgraded on 22 October (Value Engine and Value dashboard 6.0.16, AI Control Tower Core 8.0.8). The
   new version stores results in `sn_value_calculated_data_v2`. The data calls return HTTP 200, and
   the error is inside the widget.
   - "Total AI User" still works (324). It reads `sn_value_ai_user_usage`, which has data up to
     today.
2. **Even the new table is empty.** `sn_value_calculated_data_v2` has 0 rows, and
   `sn_value_calculation_status` has 0 rows.
   - 401 value templates exist (`sn_value_template_v2`).
   - AI Control Tower computes value **only for Managed AI assets**. Its home page says "Data and
     insights shown here are for Managed AI assets only".
   - On everis2, **0 of 336 AI systems were Managed**. Nobody onboarded them after the upgrade.

So this is a setup gap, not a defect: the old dashboard is stale, and the new value pipeline has
nothing to compute.

## Change (probe)

- "Summarize alert AI insights", the Q05 skill, was moved to Managed in AI Control Tower → AI assets →
  Unmanaged → AI systems → More actions → Move to Managed. It's the only one so far.
- The move created no approvals or tasks, and nothing was captured in the update set
  (`AIT-Q13-ai-value` was current).
- The asset tables are protected by field ACLs, so the REST API can't confirm the change; the UI
  confirms it (336 → 335 unmanaged).
- Revert: AI Control Tower → Managed → select → Unmanage.

## Next check

The value jobs run on schedules: "AIValue - Widget Precompute" next at 07:36 UTC, and "AIValue -
Enable Managed Asset Value Collection" next at 10:11 UTC. After they run, check:

- rows in `sn_value_calculated_data_v2` for the probe asset;
- the AI Control Tower value view.

If value appears, manage the other demo skills the same way:

- Explain SLA (AIT);
- incident summarization;
- resolution notes;
- KB generation;
- ITSM incident resolution investigation;
- Data visualization;
- the request status agent.

Use the new value view for the demo, **not** the old "Value Dashboard".

## Stuck runs ("Ongoing")

`sn_aia_execution_plan` in state `in_progress`, last 30 days: **106**.

| Created by | Runs |
|---|---|
| The test user (our QA) | 74 |
| The Spanish persona (our QA) | 25 |
| Service account | 5 |
| Another person | 2 |

So **99 of 106 are our own QA chats** that nobody ended. A conversation stays `in_progress` until the
user ends it, or until the panel's "end" button is used.

For the demo, either end the QA chats, or say that "Ongoing" counts open conversations, not failures.

## Score now

No change yet: the value story is still missing until the probe shows data. **8 of 12.**
