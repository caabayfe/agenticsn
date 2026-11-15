# 0050. Push requires content and durable capture evidence

- Status: Accepted implementation plan (product owner approval in this session)
- Date: 2026-11-14
- Requirements: G1, G3, ASR-02, ASR-08, ASR-10
- Amends: ADR-0033 items 3, 4 and 6; implements ADR-0028's published-capture requirement
- Scope: the two P1 delivery findings; no new command or MCP tool

## Context

A successful load or publish response does not prove that the reviewed build arrived. The
platform can skip a load while returning success. An older update record in the same update
set then satisfied the capture check. Compiled definitions were treated as matching any live
record. Separately, an applied but uncaptured change advanced its ledger and disappeared from
subsequent plans; even retaining the old ledger was insufficient because the ordinary
already-equal shortcut recorded it without attempting capture.

## Decision

1. Publication requires exactly one successful acknowledgement for every requested flow,
   subflow and action. Missing, duplicate, failed and unexpected acknowledgements stop push.
2. Capture is content evidence. Decode the target update's payload and compare the reviewed
   authored fields and child graph. Compare decoded JSON deterministically. Publication's
   active/status/state/version and label-cache changes on compiled heads are lifecycle changes; authored child
   changes are not. A published flow requires published status and a snapshot linked to its
   definition; an action requires published state and its linked snapshot. Compare the live head and master
   snapshot with that evidence. An unknown shape or unreadable payload fails closed.
3. An update in the application's Default set may be moved only when its content agrees and
   the signed-in user saved it. Read it back after moving. Dictionary capture may still carry
   a matching field label, provided the dictionary itself was applied and captured.
4. Before metadata writes, persist a per-unit pending receipt in the existing atomic push
   journal. Store target instance/URL/batch, project, update name, build digest, target set,
   before/observed versions, operation and verification status. Never store XML, scripts,
   business data or credentials. Keep receipts until verification **and ledger commit** finish.
5. Pending units are plan candidates even if their ledger/build hashes already agree. A new
   plan reconciles their capture read-only. Reuse verified evidence without reloading metadata;
   otherwise show an explicit create/load/delete for review. No write is automatically retried
   after an unknown outcome. A known observed version that moved, changed source, missing
   source, changed target or closed/missing update set blocks delivery. Unknown compiled
   outcomes require content evidence; existence and timestamps cannot establish ownership.
6. Commit ledger changes only for units both applied and captured. Preserve unfinished units
   across preference restoration, partial results, later failures and failed git commits. Bind
   plans to target and pending evidence as well as source, live versions and gate.
7. Legacy journals with metadata steps but no receipts block further delivery until manually
   reconciled. Preference-only legacy journals remain recoverable. A pre-upgrade ledger that
   already advanced with no surviving journal cannot reveal its missing evidence automatically;
   use the recovery procedure, never infer delivery from an empty plan.

## Consequences

Push may conservatively remain pending on a platform payload shape not yet covered by a
fixture. That is preferable to reporting an undeliverable change as complete. Recovery is
reviewed and target-specific. No immutable receipt history, new deployment UI, transaction
protocol or other P2 capability is introduced.

Live acceptance on pdi11 (Brazil patch 1, embedded SDK 4.14.0) verified creation and changed
scripts, inputs and names for a flow, subflow and action. Recorded captures establish the
supported normalization: snapshot-owned graph copies, generated runtime rows, parameter
descriptor enrichment, omitted SDK defaults and generated attributes. Authored values and
rows still require evidence. Snapshot references resolve to their definition through indexed
reads of the referenced snapshot's parent; names alone cannot establish identity. An unreadable
reference remains a mismatch. Deletions require absence and their deletion capture, rather
than a surviving published snapshot.

Receipts for deletions by ID match the exact update name, even when two deletion digests are
equal. Digest fallback applies only to keyed deletions whose synthetic ID changes on rebuild.

The missing-capture test remained pending across fresh CLI processes and a reviewed reload.
The unchanged reload did not generate a new capture on this release. Restoring the deliberately
withheld, verified test capture to its original set enabled a reviewed record-only recovery.
A separate external edit blocked both a new plan and the previous reviewed push without
overwriting the edit. This does not establish compatibility with every ServiceNow release;
see spec 014 for the tested scope and remaining checks.
