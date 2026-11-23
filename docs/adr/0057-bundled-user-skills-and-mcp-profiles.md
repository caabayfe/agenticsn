# 0057. Bundled user skills and workspace MCP profiles

- Status: Accepted; amendment A1 accepted (2026-11-21)
- Date: 2026-11-15
- Requirements: G1, G2, ASR-01, ASR-05, ASR-08, ASR-09, ASR-15, ASR-16
- Amends: 0002, 0010, 0016, 0019

## Context

Development and investigation benefit from the ServiceNow query workflows used in
ntt-mcp-hub. Copying its whole server would duplicate credentials and safety policies.
Copying skills into every workspace also produces stale versions and personal conflicts.
The product owner requested a bundled installer, shared user skills and local instructions.

## Decision

The executable embeds its workflows and query implementation. No separate Node server,
downloaded skill repository, model, or second credential store is needed.

`agent install` installs skills in the user's host discovery locations, with an ownership
manifest and a user installation lock. Missing files are installed; unchanged owned files
are updated; edited or unowned files are preserved and reported. Writes are atomic and
symbolic links are refused within installation destinations. Workspace skills are an
explicit alternative for ephemeral/cloud environments without the user's home directory.

Each workspace keeps its own marked AGENTS.md block, hooks, and MCP configuration.
Team instructions and unrelated host settings survive installation. Init installs the
integration; existing workspaces use agent install. Upgrades refresh the embedded pack.
The installer never scans unrelated repositories or installs a global AGENTS.md.

Two opt-in profiles of the same engine serve distinct tasks: investigate (mirror reads
and bounded live queries) and develop (advice, adoption, validation, plans and gated
development delivery). Each stays within 13 tools. The existing unprofiled MCP remains
compatible. Installing both is a convenience, not a credential security boundary; production
role verification, connection capabilities and development-only registration still apply.
Collaboration integrations remain separate products.

Live table reads, record reads, counts/group counts and inherited schema inspection use
the existing credential and request scheduler. They name fields, validate fields against
live schema, reject executable query expressions and credential tables, page by keyset,
and redact sensitive values before returning them. A selective indexed anchor bounds each
query branch; additional schema-validated comparisons may refine that selection. Live
investigation therefore amends the indexed-filters-only rule for these bounded post-filters. No generic REST or raw CRUD tool is
introduced. Query results are transient, ACL-limited observations, not a mirror or snapshot.
The first aggregate interface deliberately supports counts; other statistics require a
separately tested extension rather than a generic endpoint escape hatch.

Eight focused workflows cover design, build, review, explain, deliver, document,
troubleshoot and test. They apply to snagentic workspaces and route to tested engine
operations. Corrected query guidance is bundled alongside the investigation workflow.
Version-specific Build Agent/AI Agent and Jira/Confluence/Figma workflows are excluded.

## Consequences

New machines and cloud runners run agent install themselves. Personal skills do not travel
with a git clone. Workspace scope remains available for those environments. Preserved local
edits can mean an old skill remains active; installation reports that condition explicitly.
User-level installation does not create a global MCP with an ambiguous workspace binding.

## Amendments

### A1. Live queries are off on test and production unless the profile enables them, and are logged (Accepted, 2026-11-21)

Evidence: spec 016, decision D4 and finding SEC3-04; product audit of 2026-11-21. The decision
above lets the live query operations run on any configured instance, under the existing
credential checks, and records nothing about them. Live queries can read business records, so
on the instances that hold real ones the team now decides per instance:

- On an instance of kind `test` or `production`, table reads, record reads, counts and schema
  inspection are refused unless that instance's `instance.yaml` has
  `live_queries: { enabled: true }`. The refusal comes before the instance is called. The file is committed, so enabling passes review; the code reads the
  workspace's file and does not check that it is committed. Development instances are unchanged.
- Every live query that runs, on any kind of instance, is first recorded in the instance's local
  state (`.snagentic/<name>/live-queries.jsonl`, never in git): time, instance, kind, user name,
  operation, table, and the field names and operators of the filter. Filter values, returned
  data and credentials are never recorded. A query whose entry cannot be written is refused.
- The "writes no local files" property of these operations now has this one exception. They
  stay read-only towards the instance and take no workspace lock.

The log is a local record, not a control: it has no viewer command and no rotation, and is not
tamper-proof.
