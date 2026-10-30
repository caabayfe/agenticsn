# Q02 baseline: who is on call (28 October 2026, 21:54)

**Answer key** (`/api/now/on_call_rota/whoisoncall` for Network at that moment): rota "Americas";
order 1 Fred Luddy (fred.luddy@example.com, no mobile); order 2 "ITIL User" (itil@example.com, no
mobile). No escalation set defined.

**Question** (SOW panel, on INC0025307): "Who is on call for the Network group right now, who is next
if they don't answer, and how do I reach them?"

**What happened:** Incident assist first asked "Can I use the incident from the page context?"
(Yes/No). After "Yes", about 90 s later:

> Found 2 experts. Current on-call: Fred Luddy, Primary, Email fred.luddy@example.com, Phone: Not
> available. Next escalation contact: ITIL User, Secondary, itil@example.com, Phone: Not available.
> ... Phone contact is not available in the returned roster details.

| Criterion | Score | Why |
|---|---|---|
| Correct | 2 | Matches the key, order included |
| Grounded | 2 | From the rota; honest that there is no phone |
| Insight | 0 | No shift end, no "the Americas rota covers the night", nothing about the incident |
| Actionable | 0 | No "notify" or "assign" action |
| Fit | 1 | Demo people with example.com addresses; nobody in the client's groups (SAP has no rota) |
| Reliable | 2 | Right first time; one extra confirmation click |
| **Total** | **7 of 12** | |
