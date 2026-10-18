# 0037. An employee guide and an IT guide, published from one source

- Status: Accepted (product owner, 2026-10-18, after the pilot on pdi2)
- Date: 2026-10-17
- Requirements: G2 (explain an instance), ASR-15
- Amends: 0036 (how the site is organised for its readers)
- Relates to: `specs/010-verified-documentation/audiences.md` (spec 010a: one source, two views)

## Context

ADR-0036 and spec 010a organise the site by process: each process has a door for end users, one
for operators and one for the platform team. Reviewing the pdi2 documentation, the product owner
found the end-user side poor:

- an employee's first questions are how to reach IT (portal, email, phone, chat) and how to use
  Employee Center, and no process answers them;
- the entry point is a list of ITSM processes (problem, change, CMDB…), words employees don't
  use;
- end-user pages link to the operator's side and to configuration pages, which they don't need.

The SNDOC revision (NTT, 2026) documents only the agent side, so it offers no model for the
employee's view.

## Decision

1. **Two guides, one source.** The pages stay as they are (`processes/<p>/<section>/<topic>.md`,
   with shared Understand pages in two views). The site publishes them as two guides:
   - the **employee guide**: Use pages and the user view of Understand pages;
   - the **IT guide**: today's process site, for operators and the platform team.

   One source keeps the shared explanations and their evidence written and checked once.
2. **The employee guide is organised by what employees want to do**, not by process. An optional
   `employees:` block in `site.yaml` names its title, an introduction, the pages to start with
   (such as the ways to get help and how to use the portal) and task groups ("Something is
   broken", "Ask for something", "Approve"), each a list of `<process>/<topic>` pages. Each
   process's user view of its Understand pages is listed under "How it works".
3. **Cross-process employee topics are a small process of their own** (for example
   `getting-help`, with the channels and the portal). No new page kind.
4. **The guides don't mix.** With an employee guide, employee pages carry its breadcrumbs and drop
   their links to the operator's counterpart and to configuration. The front door offers both
   guides. Without the block the site is unchanged.
5. **`docs check` enforces the guide.** An entry that isn't an employee page (a Use page, or an
   Understand page) is an error (`unknown-guide-page`).

## Consequences

- Employees land on a page written for them, and stay in it.
- The order and grouping of the employee guide are an authoring decision, written down and
  checked, not inferred from processes.
- Operators lose nothing; the IT guide is the current site under `it/`.
- A page that should differ for employees still uses `{for=user}` in an Understand page, as
  before.

## Alternatives considered

- **Two documentation sources.** Rejected: the shared explanations and their evidence would be
  written and kept twice, and drift.
- **Derive the employee guide from processes automatically.** Rejected: the grouping by task is
  the point, and processes don't say which tasks employees think in.
- **A new page kind outside processes** for channels and the portal. Rejected for now: a small
  process gives them roles, capabilities, evidence and animations with no new model.
