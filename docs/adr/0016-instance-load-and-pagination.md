# 0016. Instance load and pagination policy

- Status: Accepted (claims marked *measure* are validated in milestones M1–M4)
- Date: 2026-10-05
- Requirements: ASR-06, ASR-07; new ASR-16
- Amends: plan `specs/002-v1.0-release` section 4

## Context

The product owner requires that, after the first full pull, syncs are incremental and
put almost no load on the instance. A review of v1's sync found five load problems:

1. Every incremental pull re-read **15 hours** of changes (an overlap window to absorb
   time-zone ambiguity in encoded-query timestamps).
2. Static tables (catalog, dictionary) used **offset paging plus a row count**. Offset
   paging gets slower with depth and can skip or repeat rows when data changes; the count
   is an extra query per listing.
3. If the keyset cursor stopped advancing, the listing **ended silently**, so a defect
   could truncate a sync unnoticed.
4. Detecting drift and deletes meant listing all ~280k `sys_metadata` rows.
5. Six fixed parallel requests, while REST calls share a small per-node pool of
   integration worker threads with every other integration.

v1 also got important things right, and they are kept: keyset paging on
`(sys_updated_on, sys_id)`; ending a listing only on an empty page (ACLs remove rows
*after* the limit is applied, so short pages are normal); minimal payloads
(`sysparm_fields`, `sysparm_display_value=false`, `sysparm_exclude_reference_link`,
`sysparm_no_count`).

## Decision

### 1. One pagination primitive: keyset, everywhere

- Every listing goes through one `KeysetPager` with two cursor kinds:
  - **snapshot** `(sys_id)`: complete listings such as the catalog, dictionary and
    update-set entries;
  - **change feed** `(sys_updated_on, sys_id)`: everything driven by a watermark.
- **Never** `sysparm_offset`. **Never** a row count (`sysparm_no_count=true`).
- A listing ends **only on an empty page**. A cursor that does not advance raises
  `PaginationStalledError`; it never ends quietly.
- Every request names its fields, asks for raw values (`sysparm_display_value=false`),
  excludes reference links, and filters only on indexed fields (`sys_id`,
  `sys_updated_on`, `sys_class_name`, `name`). No `LIKE` or `CONTAINS` on large tables.
- **Adaptive page size:** start at 500, adjust toward a target response time (2 s),
  bounded to 100–1000. Shrink immediately when a transaction is cancelled for exceeding
  its time quota.
- The pager is pure domain logic over a `PageSource` port. Its invariants (no gaps, no
  duplicates, correct end, stall detection, short ACL pages) are proven with property
  tests against a fake that inserts and updates rows *during* paging.

### 2. Two-tier change detection

| Tier | When | What it reads | Target cost |
|---|---|---|---|
| **Fast feed** | Every `pull` | Changed `sys_update_xml` rows, `sys_metadata_delete`, update-set changes, plugin and upgrade history since the watermark: small, indexed queries | **No changes: ≤ 5 requests.** *measure* |
| **Fingerprint reconciliation** | `pull --verify`, after a plugin activation or upgrade, and on a schedule (default weekly) | One aggregate query per hierarchy: count and latest `sys_updated_on` grouped by `sys_class_name`. Ids are listed only for classes whose fingerprint differs from the local one | A fraction of a full inventory. *measure* |

`pull --full` stays as the explicit, rare safety net.

### 3. Time semantics instead of a large overlap

- Values are read raw (UTC). `doctor --instance` verifies how the instance interprets
  timestamps in encoded queries for the integration user (*measure* in M1, with a probe
  record).
- The overlap window then only covers in-flight transactions and clock skew: **default 10
  minutes**, instead of 15 hours. Records seen again inside the overlap are skipped by
  `sys_mod_count` and hash, without being downloaded.

### 4. Load governance

- **One request scheduler per instance**, shared by every operation in a process:
  - default concurrency **2**, adaptive up to 4 (additive increase while latency is
    stable; halved on 429, 503 or rising latency);
  - `Retry-After` honored; exponential back-off with jitter;
  - a per-run request budget.
- Requests identify themselves (`User-Agent: snagentic/<version>`), so administrators can
  see and rate-limit them.
- **Cancellation is real.** Ctrl-C or an MCP cancellation aborts in-flight and queued
  requests.
- **Server cost report.** After a pull, snagentic reads its own transactions from the
  instance's transaction log and reports requests, server time and SQL time, so "almost
  no impact" is measured, not claimed. If the integration user cannot read the log, the
  report says so.

### 5. Pagination toward users and agents

CLI and MCP list outputs are bounded (default limit) and return an opaque cursor for the
next page (ADR-0003). Local reads of the mirror stream records instead of loading them all.

## Consequences

- New ASR-16: an incremental pull with no changes uses at most 5 requests; the server
  cost of every pull is reported.
- The plan's milestones change: M1 adds the scheduler, cancellation and time-semantics
  probe; M3 adds the pager and its property tests; M4 adds fingerprints and the cost
  report.
- Use cases receive a cancellation signal and a progress reporter (done in this review).

## Appendix: local CPU cost of hashing (measured in this review)

`recordHash` processes about 29,000 real records per second (49 MB/s) on an Apple
Silicon laptop: about 10 seconds for a full pull of the PDI (≈ 280k records), and
negligible for incremental pulls. Most time is per-record overhead plus SHA-256 in pure
JavaScript (`@noble/hashes`); a native digest is about 9× faster but would break kernel
purity (ADR-0001). An escaping fast path was tried and gave no measurable gain, so it was
not kept. Revisit only if a full-pull profile shows hashing above 10% of wall time.
