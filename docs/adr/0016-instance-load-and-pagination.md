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

## Appendix: first measurements against the PDI (2026-10-05)

Instance `dev312411` (PDI, US data center), measured from Europe; round trip about 0.5 s.

| Question | Finding | Consequence |
|---|---|---|
| How are literal timestamps in encoded queries interpreted? | As **raw UTC**: `sys_updated_on=<raw value>` matches; the display-zone value does not; `>`/`>=` are exact to the second. Only `javascript:gs.dateGenerate()` uses the user's zone. | The overlap window only needs to cover in-flight transactions and clock skew. `doctor --instance` re-checks this per instance. |
| Does the instance report its own pressure? | Yes: `Server-Timing: sem_wait;dur=…, sesh_wait;dur=…` on every response (time spent waiting for a worker semaphore and for the session). `X-Transaction-ID` identifies each request. | The scheduler slows down when `sem_wait` rises, not only on 429/503. The transaction id ties requests to the server cost report. |
| Change feed on `sys_metadata` (parent), 100 rows | 2.6 s | Too expensive for every pull. |
| Change feed on `sys_update_xml`, 100 rows | 0.59 s | Suitable for the fast feed. |
| "Anything changed?" probe, `limit=1`, empty result | 0.62 s (mostly round trip) | Five probes ≈ 3 s: ASR-16 is reachable. |
| Aggregate count + max by `sys_class_name` over `sys_metadata` | **Denied** after 11.8 s (field ACLs across the hierarchy) | Fingerprints run **per hierarchy root**. |
| Aggregate per hierarchy (`sys_script`, grouped by class) | 0.85–0.93 s | Fingerprint reconciliation cost ≈ number of hierarchy roots; measured in M4. |

## Appendix: guarantees and limits of keyset paging (M3a property tests)

Proven by property tests against a fake Table API that applies ACLs after the limit, has
many rows per second, and changes data while paging:

- **Guaranteed:** every visible row is returned exactly once by a snapshot or change-feed
  listing, however pages are cut; a cursor that stops advancing raises
  `PaginationStalledError`.
- **Within one run, not guaranteed:** a row updated *during* the run into the cursor's own
  second with a smaller `sys_id`. The next pull's overlap window returns its latest version;
  the tests assert this two-run guarantee.
- **Known Table API limit:** ACLs remove rows after `sysparm_limit` is applied, so a page made
  only of rows the user cannot read comes back empty and looks like the end. An admin
  integration user is not affected (`doctor` warns otherwise). Fingerprint reconciliation
  (per-class counts, M4) detects any resulting gap.

## Appendix: first live run of the pager (PDI, 2026-10-05)

- Snapshot of `sys_script`: 6,404 rows, no duplicates, **9 requests, 5.8 s** (pages grew
  500 → 750 → 1,000), concurrency 2, 1 ms semaphore wait. Change feed on `sys_update_xml`
  since 2026-09-01: 474 rows, 2 requests, 0.7 s.
- **Coverage gap found by the count cross-check:** the aggregate count is 6,471, but 67
  business rules are never returned by any Table API read, even for `admin`, and even
  without paging (one unordered 10,000-row request returns the same 6,404). They belong to
  two private applications with scoped administration: `sn_kmf` (Key Management Framework,
  50) and `sn_secrets` (Secrets Management, 17). Reading them needs the applications' own
  administrator roles.
- **Consequence:** the sync never assumes it saw everything. The coverage report compares
  listed rows with aggregate counts per scope and names unreadable scopes explicitly
  (milestone M4).

## Appendix: incremental change detection, measured (M4, 2026-10-05)

Measurements and one controlled experiment on the PDI changed the fast-feed design.

| Finding | Evidence |
|---|---|
| A layout change touches neither the parent record nor update sets | Inserting a form field (`sys_ui_element`) into Incident's default section through the Table API left the section's `sys_updated_on` and `sys_mod_count` unchanged and created no `sys_update_xml` entry (row removed afterwards) |
| One aggregate request per table returns count and latest update time | `sys_metadata`: 655,259 rows, 1.6 s; child tables 0.5–0.8 s each |
| Per-class aggregates across the `sys_metadata` hierarchy are denied | `group_by=sys_class_name` on `sys_metadata` returns "insufficient rights"; ungrouped counts and filtered counts are allowed |
| Deletions are recorded directly | `sys_metadata_delete` holds the deleted record's id (`sys_metadata`) and class (`sys_db_object`) |
| Ordered change feed on `sys_metadata` | 2.7–2.9 s per page, including an empty one |

**Decision: fingerprints first.**

1. Every incremental pull reads one fingerprint (count and latest `sys_updated_on`) for
   `sys_metadata` and for each child table: **15 aggregate requests**. If all equal the last
   pull's fingerprints, nothing changed and the pull ends. (Implementation count: `sys_metadata`
   plus 19 child tables, **20 requests**; corrected below.)
2. A changed `sys_metadata` fingerprint triggers its change feed (since the watermark minus
   the overlap) and the `sys_metadata_delete` feed; only changed records are downloaded.
3. A changed child-table fingerprint triggers that table's change feed; affected owners have
   their child rows re-read. A lower count means rows were deleted, so the table is re-listed.
4. Known blind spot: a change written with system fields disabled (no new `sys_updated_on`)
   and without a count change is invisible to fingerprints; `pull --full` remains the safety
   net.

ASR-16 is revised from "at most 5 requests" (set before these measurements, and unable to see
layout changes) to **one aggregate request per change source and under 10 s when nothing
changed**.

### Amendment: implementation results (M4, 2026-10-05)

There are 20 change sources (`sys_metadata` and 19 child tables), not 15. Two refinements
came from building and running it:

- **Lost child rows are found by count, not by re-listing.** A lower child-table count used
  to mean re-listing the table (`sys_ui_element`: 71,734 rows, about 72 full-record pages).
  Instead, one grouped aggregate (`group_by=<parent field>`, 0.6–4.9 s, 7,010 groups for
  `sys_ui_element`) is compared with the rows mirrored per owner (counted locally with
  `git grep -c '^- '`, 0.2 s), and only owners whose counts differ are re-read. Nested
  families (workflow structure) are small and are still listed again together.
- **Deletions without a deletion record are reported.** `sys_metadata_delete` rows are
  `sys_metadata` rows themselves, so a normal deletion leaves the count unchanged. Count before
  + records created − deletion records created between the two fingerprints must equal the
  count after; a shortfall (for example, a deletion record deleted, or a script deleting with
  workflow off) is reported with `pull --full` as the remedy. Grouping `sys_metadata` by scope
  is allowed (771 groups, 2.6 s) and grouping by class is not; precise bisection
  (scope, then class, then sys_ids) is left to `pull --verify`.

Live results on the PDI (Europe to US, about 0.6 s per request):

| Pull | Requests | Time | Result |
|---|---|---|---|
| Nothing changed | 20 | 3.8–4.7 s | no commit; 83 MB peak memory (the mirror tree is read only when something changed) |
| New business rule + new form field | 29 | 11.9 s | 3 files: the rule's YAML and script, the section's child rows |
| Rule renamed and edited + form field deleted | 29 | 11.4 s | rename detected; the lost row found by grouped count |
| Rule deleted | 26 | 10.4 s | rule files removed; its deletion record added |

Known blind spots, unchanged: writes with system fields disabled that leave counts equal, and a
child row moved to another owner (the old owner keeps a stale copy until it changes again).
`pull --verify` and `pull --full` are the remedies.

## Appendix: verification by counts (`pull --verify`, M4, 2026-10-06)

Fingerprints miss changes that leave counts and timestamps as they were: records deleted without
a deletion record, inserts with old timestamps, child rows moved between owners. `pull --verify`
reconciles the mirror with the instance by counts and repairs what differs.

**Measured constraints (PDI):**

| Finding | Evidence |
|---|---|
| `sys_metadata` cannot be grouped by class, but can be grouped by scope and filtered by class | `group_by=sys_class_name` denied (field ACL); `group_by=sys_scope`: 771 groups, 2.6 s; `sys_class_nameNOT IN…` allowed |
| Class grouping works on every other table | `sys_script`, `sys_hub_flow_base`, `sys_ui_policy` all answer |
| Aggregates count rows that listings hide | 50 business rules counted in `sn_kmf`, 0 listed |
| `global` holds most records | 455,778 of 655,259 |

**Design:**

1. Records: one grouped count of `sys_metadata` per scope, leaving out classes a pull never
   mirrors and classes this user cannot read. Where a scope's count differs from the mirror's
   (counted locally), parts of up to 16,000 records are listed (`sys_id`, `sys_class_name` only)
   and compared; larger parts are split into 16 `sys_id`-prefix counts. A difference spread over
   more than 4 of the 16 parts is listed outright rather than split further.
2. What the mirror cannot hold (rows hidden from listings, records of unreadable classes,
   invalid sys_ids) is remembered per part in the sync state and subtracted next time, so a
   verification lists only where something actually changed.
3. Child rows: grouped counts per owner on every child table, compared with the rows mirrored
   per record, as for shrunk tables.

**Bug found and fixed on the way:** `sys_variable_value.document_key` usually names a flow
step or action instance, not the record. Count reconciliation compared counts per key with
counts per record and removed 698 variable-value files from the PDI mirror (the instance was
never affected; the files were restored by the next verification, byte-identical to the full
pull). Owners are now resolved as the full pull does, through child-row ids read from the
mirror (`git grep`). The same flaw affected incremental pulls on `main` whenever
`sys_variable_value` lost rows.

**Live results (PDI):**

| Verification | Requests | Time | Listed | Result |
|---|---|---|---|---|
| First (learning) | 1,052 | 23 min | 367,272 ids | removed the stale deletion record; before the fixes above |
| Learning, with fixes | 987 | 7.4 min | 339,154 ids | 2,486 hidden and 1,691 unmirrorable records remembered |
| Steady state | 59 | 33 s | 0 | 760 scopes agree; child tables agree |

The learning run is paid once per workspace (and again after a full pull). Known limits:
content-only changes with system fields disabled stay invisible (verification checks
existence, not content); a part whose remembered gap and a real loss cancel out is missed.
Peak memory of a verification is about 0.9 GB on the PDI (mirror index and child-row owners).

## Appendix: server cost, measured by every pull (M4, 2026-10-06)

ServiceNow logs every request in `syslog_transaction` (response, SQL, CPU, ACL and business
rule time; SQL query count; semaphore wait). Each connection now tags its requests with a run
id in the User-Agent (`snagentic <version> run/<8 hex>`), and every pull ends with one
aggregate request summing its own logged transactions. The time filter starts five minutes
before the pull, so a skewed local clock cannot hide requests; the tag does the matching.
Users who may not read the log (usually read-only users) get "unavailable", never a failed pull.

Live on the PDI:

| Pull | Requests | Server time | SQL | Slowest transaction |
|---|---|---|---|---|
| Nothing changed | 20 | 4.1 s | 2.9 s in 568 queries | 1.9 s: `sys_metadata` count + latest update |
| `--verify`, steady state | 59 | 15.9 s | 9.4 s in 1,646 queries | 3.7 s: `sys_metadata` grouped by scope |

The `sys_metadata` aggregates dominate: about half of an idle pull's server time. The child
tables' 19 fingerprints together cost less than that one request.

## Appendix: plugins, installs and the inventory (M6, 2026-10-06)

- **Installs keep packaged timestamps.** Activating a plugin on the PDI inserted records whose
  `sys_created_on` and `sys_updated_on` are the packaged ones (2019–2023): no change feed saw
  them, and only `--verify` recovered them (at a cost of 339 requests, because five new records
  in `global` looked like a spread difference). Their package does change: when `sys_metadata`
  moved, the record step also lists records whose `sys_package.sys_updated_on` is at or after
  the change window. Measured: one activation, 9 records, 0.7 s. A record counts as created
  (for the lost-record check) only when its package was created in the window.
- **Inventory signals.** Plugins are refreshed when the active counts of `v_plugin` move, store
  applications (read through `sys_scope`, since `sys_store_app` is not readable even by admin)
  when the `sys_scope` fingerprint moves. Two aggregate requests: an idle pull is now 22
  requests, 4.4 s (3.2 s of server time).
