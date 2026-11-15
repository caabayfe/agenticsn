# 0057. Bundled user skills and workspace MCP profiles

- Status: Accepted
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
