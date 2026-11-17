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

The pdi12 SLA Task fixture (SDK 4.14.0, 2026-11-15, #271) extends known capture shapes with the
native application trigger's runtime input/schema projection. Verification reads the referenced
native output, schema and optional parameter definitions through indexed paged queries. Only
owned rows matching those contracts count as generated. An SDK empty complex default may be
rehydrated into the same empty native value; integer string serialization and reference captions
retain the authored execution values. Native optional empty inputs require an independently
read optional/empty default, matching identity and inactive scripts. Changed scripts/values,
unknown or duplicated inputs, unrelated schemas and generated-record deletions still fail.
Both normal delivery and pending reconciliation use this comparison; published snapshot,
live version, source and target checks remain unchanged. Support is confined to the recorded
SLA Task shape; unavailable native evidence fails closed.

Receipts for deletions by ID match the exact update name, even when two deletion digests are
equal. Digest fallback applies only to keyed deletions whose synthetic ID changes on rebuild.

The missing-capture test remained pending across fresh CLI processes and a reviewed reload.
The unchanged reload did not generate a new capture on this release. Restoring the deliberately
withheld, verified test capture to its original set enabled a reviewed record-only recovery.
A separate external edit blocked both a new plan and the previous reviewed push without
overwriting the edit. This does not establish compatibility with every ServiceNow release;
see spec 014 for the tested scope and remaining checks.

### New-flow draft evidence for a reviewed reload

A load can finish after its client times out, before publication. An original capture of
an inactive draft is not published delivery evidence and cannot advance the ledger. For a
new flow only (create receipt, absent before, no observed acknowledgement, unchanged build),
normal planning may establish ownership for an explicit reload by proving the original
draft capture and independently reading its current authored graph. Read runtime families
even when absent from the build, so an extra branch/action is not hidden by a stale capture.
Use indexed owner queries and the shared keyset pager, with bounds on graph size; unknown
ownership shapes, unreadable evidence, snapshots, foreign domains, changed values or versions
remain refused. Re-read the head, including both snapshot pointers, after the graph reads.

This proof produces an observed version for a **load**, never a verified receipt or record
operation. Source, target, update-set ownership, gate and fresh plan approval still apply;
normal load/publication acknowledgements, published snapshot, capture and live read-back are
required before completion. Receipt-only recovery stays read-only and rejects unpublished
drafts. Existing-flow updates with an unknown outcome remain conservative. No public flag,
new command, automatic retry, journal edit or capture-checker exemption is introduced.

PDI13's recorded native schema confirms the supported ownership field names. Simulated
completed-load/client-timeout tests cover an explicit reviewed reload, publication and final
receipt clearing, plus stale captures, direct child edits, extra branches/mappings, snapshot
pointers, domains, changed source/versions, unreadable evidence and request/row bounds.
Native recovery acceptance remains required; these tests alone do not certify PDI13 delivery.

The mutable draft read projects only fields present in the independently read inherited
native schema. SDK XML defaults such as action-instance `active` and trigger `category`
are absent from the native child tables; a Table API empty projection cannot stand in for
an authored value. Reuse the existing recorded-default comparison only for schema-absent
fields. Preserve readable empty values, require visible owner columns before listing,
and refuse unreadable schema. Cache only schema field sets within one project plan, while
re-reading live content and versions for each proof. Foreign declared domains still refuse.

Native approval capture on pdi12 (Brazil, SDK 4.14.0) additionally records two publication
defaults: computed document references and relative approval deadlines lose only the SDK's
duplicated display label, and Ask for Approval adds an unassigned optional journal-field
descriptor. Recognize only the recorded shapes with unchanged execution values, empty defaults
and disabled scripting. Explicit labels, supplied or missing authored values, changed parameter
types, duplicate descriptors and unknown shapes remain mismatches. The recorded fixture and
negative mutations establish this compatibility; receipt and live-snapshot checks are unchanged.

The recorded pdi12 request subflows extend that evidence to string-variable assignment
parameters and optional branch captions. A generated variable descriptor must match its
independently authored variable identity, type, size, order, mandatory flag and default, contain
only the recorded metadata keys, and leave the assignment value and script unchanged. Empty
branch inputs additionally require indexed native logic-input evidence. Referenced subflow
snapshots still require independently proven ownership; numeric string exports preserve the
exact authored integer, and generated reference captions preserve the exact execution value.
These indexed reads are confined to changed flow/subflow captures with logic; SLA captures reuse their existing contract reads. Missing native
contracts, changed conditions/scripts/defaults, duplicate assignments, unknown descriptor keys
and changed live versions remain refused by the recorded negative cases.

The recorded pdi12 Service Catalog capture extends the same independent native-output and
parameter evidence to its generated request-item input and runtime catalog trigger. Hidden test
outputs are not runtime inputs. The runtime ID belongs to the published head; execution mode
comes from the authored trigger. Native optional action inputs must match independent identity,
type, mandatory flag and empty default. Recorded boolean/integer serialization and implicit
choice captions keep their execution values, while explicit captions, nonempty added inputs,
unknown records-parameter keys, changed trigger mode/target and duplicate/deleted generated
records remain mismatches. Reads are bounded and indexed, confined to changed catalog captures;
logic contracts reuse those reads. Both normal capture and pending reconciliation use the same
comparison. The linked snapshot, unchanged live version and original pending receipt remain
required for recovery.

The recorded catalog-item capture omits the SDK's generated empty `sc_cat_item.view` default;
that column is absent from the native dictionary. Only the empty value is compatible. Nonempty
authored/captured values and missing ordinary fields still fail. Known omitted defaults also
refuse conflicting captured values, including where reference-name compatibility would otherwise
lack evidence. Catalog-item names, active flags, descriptions and fulfilment flow bindings
remain compared. No capture, live-base, receipt or target check is skipped.
