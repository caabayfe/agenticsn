# 0040. Every feature of a process is found and has a decision

- Status: Accepted (product owner, 2026-10-19; piloted on incident, pdi2)
- Date: 2026-10-18
- Requirements: G2 (explain an instance), ASR-09
- Amends: 0036 (what the documentation covers)
- Relates to: 0037 (the guides), 0039 (impact and release notes)
- Plan: `specs/010-verified-documentation/features.md`

## Context

The documentation covers what its author thought of. On pdi2 the incident pages never mention
Discuss, Playbook, Agent Assist or Create Knowledge, although all are on the incident form, and
they mention communication plans only in passing. The method we learnt from, the SNDOC revision,
has the same gap: it rewrote the pages an old Confluence tree had, with no inventory of the
instance.

The configuration index (spec 010a, A3) lists records whose table field names one of the
process's tables. On pdi2 that is 369 records no page cites, a list too long to act on. It still
misses most features, because a feature is usually an application that reaches the process from
the side: communication plans are their own tables, whose `source` refers to the task; Discuss
is part of the workspace's page, built in UI Builder.

## Decision

1. **A census per process, from the mirror.** `docs census <process>` gathers the records that
   reach the process's tables, grouped by the application (scope) that owns them:
   - UI actions and workspace actions on the tables, or on the tables they extend (`task`);
   - business rules, client scripts, UI policies, notifications and SLA definitions on the
     tables;
   - tables with a reference to the process's tables, and, from applications other than the
     platform's own (global), to the tables they extend.

   Each group shows its counts and the names a person sees (button labels, table names). Reads
   only the mirror; adds no request to the instance (ADR-0036 item 9).
2. **Features are declared, with a decision each.** `processes/<process>/features.yaml` lists
   the process's features. Each has an id, a title, the applications the census found it in
   (`found:`), and a status:
   - `documented`, with the capabilities whose pages cover it;
   - `todo`;
   - `out-of-scope`, with the reason and who decided;
   - `question`, with what to ask.
3. **What the census can't see is declared from the screen.** A feature found by looking at the
   form as each role (a workspace button, a side panel) is declared with `seen:` (by, on,
   where), like seen evidence. The skill makes this walk part of every process.
4. **`docs check` enforces the decisions**, for each process that has a `features.yaml`:
   - an application the census finds that no feature names is a warning
     (`undecided-feature`): new functionality after a pull or an upgrade is noticed;
   - a documented feature without capabilities, or naming one the process doesn't have, is an
     error.
5. **The IT guide shows coverage.** The process page lists the features with their status and
   links; the IT guide's process card shows how many are documented.
6. **Sub-features are capabilities of the process**, grouped by feature. Communication plans
   and Discuss become capabilities of incident with their own Use, Operate and Configure pages
   and animations, as any other.

## Consequences

- Nothing on a process's tables goes unnoticed: each application reaching it is documented or
  explicitly left out, with a reason a reviewer can challenge.
- The census reads every dictionary entry in the mirror (143,000 on pdi2). It filters on the raw
  text before parsing, and runs in `docs check` only for processes with a `features.yaml`.
- Grouping by application is a heuristic: one application can hold several features (split them
  in `features.yaml`, several features can name the same application), and one feature can span
  several applications.
- Features built only into workspace pages depend on the screen walk, which is a person's or an
  agent's work, not a check.

## Alternatives considered

- **List every record (the configuration index).** Kept for the platform team, but rejected as
  the coverage measure: 369 records with no grouping is not a decision anyone can make.
- **Parse the workspace's UI Builder pages for buttons and panels.** Rejected for now: the page
  definitions are deep, version-specific JSON. The screen walk finds the same things more
  reliably. Revisit if the walk proves too costly.
- **Coverage by plugins only.** Rejected: plugins are coarse (one plugin adds many features) and
  say nothing about which process they reach.
