# Q10 and Q11 baselines: wrong door and analytics (28 October 2026)

Both run in the Service Operations Workspace Otto panel, as the test user (admin, language English).

## Q10 Wrong door: a request logged as an incident

**Answer key:** INC0025308 ("Necesito un segundo monitor", the current one works fine) is a request,
not an incident. The assignment rule sent it to Network. The catalog has the right items: Standard
22", 24" and 27" Monitor. A top answer, in Spanish: it's a request; the item is "Standard 24" Monitor"
(or ask the size); reassign or convert, with one action.

**Question:** "Is INC0025308 really an incident? What should I do with it?"

**Answer (about 30 s):**
> INC0025308 does not appear to be a true incident ... the user is requesting a second monitor while
> also stating that the current one works fine, which indicates a service request / workplace
> equipment request ... Because it is currently assigned to Network, it likely needs to be re-routed
> to the team that handles employee hardware/workplace requests ...

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 2 | 2: quotes the record | 2: spots the wrong group | 1: no catalog item, no conversion offered | 1: English | 1: one run | **9 of 12** |

**Gap:** name the catalog item and offer the conversion (Create request from incident exists in SOW);
answer in the user's language.

## Q11 Analytics: incidents last month by priority

**Answer key** (stats API, `opened_at` by month):

| Month | P1 | P2 | P3 | P4 | P5 | Total |
|---|---|---|---|---|---|---|
| August 2026 | 6 | 86 | 422 | 326 | 3 | 843 |
| September 2026 | 8 | 90 | 432 | 364 | 1 | 895 |
| October 2026 (to 28th) | 9 | 64 | 356 | 252 | 2 | 683 |

A top answer: September 895 incidents (P1 8, P2 90, P3 432, P4 364, P5 1), 6 % more than August,
driven by P4 (+38) and P3 (+10); P1 went from 6 to 8; a bar chart; a link to the list.

**Run 1 (21:06, with the Max Tab dialog open):** the incident agent took the question and gave up:
"I couldn't retrieve the month-over-month incident counts by priority ... so I can't give you an
accurate count or comparison." Honest, but no answer.

**Run 2 (21:08, new chat):** "Create a Data Visualization" took it. It said "I'll generate a report
showing incidents opened last month by priority and compare it with the previous month" and drew a
**line chart from August 2015 to 2026**, by priority, with no numbers and no comparison. The stored
configuration shows why:

```
label: Incidents opened by priority: last month vs previous month
filter_query: opened_at>beginningOfLastMonth ^OR opened_at<endOfLastMonth
              ^OR opened_at>monthsAgoStart(2) ^OR opened_at<monthsAgoEnd(2)
```

The conditions are joined with **OR**, so the filter matches every incident ever opened. The label
claims what the chart doesn't show.

**Refinement:** typing "Show only September 2026 and August 2026 as a bar chart by priority, with the
numbers" was ignored until "Change visualization type or condition" was picked. After picking it and
asking again, the filter was right (`Opened > 2026-08-01 .and. Opened < 2026-09-30`, bar, by
priority) but the chart **rendered empty**.

| Correct | Grounded | Insight | Actionable | Fit | Reliable | Total |
|---|---|---|---|---|---|---|
| 0: wrong filter, no numbers | 1: real data, wrong scope | 0 | 1: view details, add to dashboard | 1: English | 0: three runs, three outcomes | **3 of 12** |

**Gap:** the text-to-analytics skill builds wrong date filters (OR) and gives no narrative. Options to
explore: a saved "Incidents by priority, monthly" report or Performance Analytics indicator the agent
can read; a narrative step after the chart; test the same question in Spanish.
