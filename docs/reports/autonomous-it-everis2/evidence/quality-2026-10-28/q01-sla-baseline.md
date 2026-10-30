# Q01 baseline: "why did the SLA breach?" (28 October 2026, evening)

The first quality baseline, run with the method in
[../../capabilities/70-quality-plan.md](../../capabilities/70-quality-plan.md): answer key first, from
the records, then the question in the Otto panel.

## Test record

INC0010147, "[SYNTHETIC] Lentitud intermitente y timeouts al guardar pedidos en la app de ventas
corporativa". P2, In Progress, assigned to Database (Beth Anglin), 4 reassignments. SLA "Priority 2
resolution (8 hour)" in progress, breached, 766 % of business time.

## Answer key (from `sla_breakdown_by_assignment` and `sys_journal_field`)

- The 4 reassignments happened between 09:44:16 and 09:45:35 on 30 April: Service Desk, Network,
  Hardware, Software, Database. All of them together took about **80 seconds** of SLA time.
- Database (Beth Anglin) has held the incident since 09:45:35 on 30 April. Its breakdown row is the
  only one marked breached, and it is still active.
- The last work note is from 30 April, 13:52. Nothing has been written for six months.
- **Correct diagnosis:** the breach was caused by the Database group, which kept the incident without
  progress or updates. The reassignments were not the cause.

## What the panel answered

1. "Explain the SLA for INC0010147" went to **Incident assist** (execution plan), not to the
   Explain SLA workflow. It listed the SLAs correctly: resolution breached, response met.
2. "Why did the resolution SLA breach, and which group or person caused the breach?" (same chat):

   > the resolution SLA breached because the incident stayed unresolved past the 8-business-hour
   > target ... The incident history explicitly shows multiple reassignments across groups: Service
   > Desk -> Network -> Hardware -> Software -> Database. So the most evidence-based reason for the
   > breach is: Delay caused by repeated reassignment and prolonged investigation across multiple
   > teams ... I cannot reliably name a single group or individual ...

   **Wrong.** It names the reassignments, which cost 80 seconds, as the cause, and it doesn't name
   the Database group or the six months without updates.
3. "Explain SLA" (the workflow's exact name), new chat: a search result listing three "Service Level
   Agreements" links. Not the agent.

## Findings

- The **Explain SLA** agentic workflow (4 tools: matching SLA, SLA timeline, SLA breakdown, task SLA
  details; 12 follow-up questions including "Who caused the SLA to breach") has **0 executions ever**.
  It is a template with no activation. Every SLA question goes to Incident assist.
- This morning's SD13 "pass" was also answered by Incident assist ("From the information I have...").
- `sla_breakdown_by_assignment` holds 79 rows in total and none from the last 30 days: new incidents
  don't produce breakdown data, so even the activated agent would have nothing to break down for them.
- Score for "why did it breach": Correct 0, Grounded 1, Insight 0, Actionable 0, Fit 1, Reliable 1 =
  **3 of 12**.
