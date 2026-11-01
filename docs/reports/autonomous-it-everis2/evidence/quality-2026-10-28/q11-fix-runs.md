# Q11 fix: analytics from a question (29 October 2026)

Baseline: see `q10-q11-baselines.md`. The chart joined its two date conditions with OR, so it counted
every incident.

**Answer key** (re-checked through the stats API), incidents opened by priority:

| Month | P1 | P2 | P3 | P4 | P5 | Total |
|---|---|---|---|---|---|---|
| August 2026 | 6 | 86 | 422 | 326 | 3 | 843 |
| September 2026 | 8 | 90 | 432 | 364 | 1 | 895 |

All runs are in the Service Operations Workspace Otto panel, as the Spanish persona (admin
impersonation).

## Change

The persona has a new role, `now.assist.creator.analytics`. Without it, the panel doesn't route to the
Data Visualization Generation agent: run 0 fell back to AI search, gave two links, and read
"abiertas" as open incidents. No chart.

## Runs

| Run | Question (Spanish) | Result | Score |
|---|---|---|---|
| 1 | "¿Cuántas incidencias se abrieron el mes pasado por prioridad, comparado con el mes anterior? ... barras" | Filter `opened_at > start of 2 months ago AND opened_at < end of last month`. **The AND is correct now**, and the data call returns exactly the key. But the chart type is `bar` with a monthly trend, which draws **nothing**: the chart area is empty (no bars, no labels). | 5 |
| 2 | "Crea un gráfico de columnas con las incidencias abiertas en septiembre de 2026 agrupadas por prioridad" | It added `active = true`, reading "abiertas" as still open. The chart shows P4 32, P3 25, P2 8, which matches its own filter but is the wrong question. | 5 |
| 3 | "Compara en un gráfico de columnas apiladas las incidencias registradas en agosto y en septiembre de 2026, por mes y por prioridad" | Type `column`, filter 1 Aug to 30 Sep (AND), trend by month, stacked by priority. **Correct chart**, matching the key. No numbers or narrative in the text. | 9 |
| 3b | Follow-up in the same chat: "¿Cuántas incidencias hubo en cada mes...?" | Ignored ("¿Qué le gustaría hacer a continuación?"). The visualization topic holds the chat until the user leaves the topic. | n/a |
| 4 | New chat: "¿Cuántas incidencias se registraron en septiembre de 2026 frente a agosto de 2026, y qué prioridad explica la diferencia?" | English label. It grouped by raw `opened_at` with no trend, so the x axis shows age buckets "1-2 meses" and ">2 meses". **Misleading.** No numbers, no answer to "which priority explains the difference". | 3 |

## What we learned

- **The OR bug is gone** when the question names both months and the persona has the analytics
  role. What's left is the chart type and the wording.
- **Wording matters a lot.** "registradas" (logged) is safe; "abiertas" means "still open" to the
  agent. "columnas apiladas ... por mes y por prioridad" gives the right chart type, and "barras" plus
  a month comparison gives an empty chart.
- **The agent never answers with numbers or a narrative.** It draws a chart and stops. The
  sponsor's question ("which priority explains the difference": P4 +38, P3 +10) needs a narrative
  step.

## For the demo

Use run 3's wording exactly, as the Spanish persona. Say the numbers out loud from the key: about 6 %
more incidents in September, most of the growth in P4 (+38) and P3 (+10). Don't ask follow-up
questions in the same chat.

## Fix still open (needs a build decision)

A Global "narrative" agent with one script tool: a `GlideAggregate` count per group per period,
returning the numbers and the largest changes. The panel would call it after the chart. It's in the
quality plan, not built yet: about half a day, plus QA on the 10-question key in both languages.

**Status:** 3 → about 9 of 12 with the demo wording; the chart is right, the numbers are verbal.
