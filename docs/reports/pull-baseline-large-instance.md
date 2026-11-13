# Pull baseline: a large instance (spec 014, P3)

- Date: 2026-11-12 and 2026-11-13
- Instance: `everis2`, a demo instance with about 870,000 metadata records, measured from Europe
- Build: release 2.20.1 for the full pull, `--verify` and the local commands; 2.20.0 with the
  fixes of #259 for the incremental pulls (the same code as 2.20.1)
- Profile: kind `development`, an admin user, reads only (no push, adopt or install). The plan
  asked for a read-only credential (D5); the owner approved the admin user for this run.
- Load limits: the test and production defaults (`max_concurrency: 2`,
  `requests_per_second: 5`, budget 20,000) for the full pull and `--verify`; the development
  defaults (4 and 10) for the incremental pulls
- Server cost from `pull --cost` (the instance's transaction log)

## Result

| Measure | Full pull | Incremental, 4 days of changes | Incremental, no change | `--verify` |
|---|---|---|---|---|
| Wall time | **4,466 s (74 min)** | 366 s (about 245 s of it the one-time re-scan) | **6.2 s** | 801 s (13 min) |
| Requests | 7,445 (37% of the budget) | 253 | **24** | 1,216 |
| Retries, timeouts | 0, 0 | 0, 0 | 0, 0 | 0, 0 |
| Peak requests in flight | 2 | 4 | 3 | 2 |
| Records written | 867,177 in 2,880 classes | 587 (2 renamed, 43 deleted) | 0 | 215 recovered, 9 removed |
| Server response time, total | 4,367 s (slowest 15.6 s) | 58.7 s (slowest 2.7 s) | 2.5 s (slowest 1.0 s) | 1,164 s (slowest 14.7 s) |
| of which SQL | 495 s, 276,364 queries | 14.9 s | 1.5 s, 621 queries | 401 s |
| of which ACL | 2,780 s | 19.8 s | 0.01 s | 420 s |
| Peak client memory | 671 MB | 893 MB | 131 MB | 1,421 MB |

Full pull phases: catalog 24 s, records 3,397 s, child rows 660 s (289,687 rows), operational
inventory 22 s, commit 21 s. Mirror: 1,181,669 files, 482 MB of git after the pull's repack.
89 tables are unreadable even for admin (mostly AI, governance and security configuration), as on
a PDI (79). The secret scan redacted 8 values before anything was written.

### Local commands on the full mirror

macOS on Apple silicon, Apple Git 2.54.

| Command | Time | Peak memory |
|---|---|---|
| `integrate` (first: 1,181,669 files checked out) | 104 s | 1.3 GB |
| `git status` afterwards | 5.6 to 8 s | |
| First `find` (builds the knowledge index, 1.1 GB) | 141 s | 1.4 GB |
| Later `find`, `find --code`, `describe incident`, `status` | 5.7 to 8.3 s each | 420 MB |

## Findings

1. **An idle pull is nearly free at this size.** 24 requests, 6.2 s, and 2.5 s of server time:
   ASR-16's target (one aggregate per change source, under 10 s) holds on an instance about twice
   a PDI's size. The `sys_metadata` change feeds don't scan (the slowest request took 1.0 s), so
   making `sys_update_xml` the primary feed, as the plan proposed in that case, isn't needed.
2. **The first full pull is the one heavy run.** At the production limits it took 74 minutes and
   used 37% of the request budget. The instance spent about one transaction-second per second of
   the pull, two thirds of it evaluating ACLs, even for admin. Nothing was retried or slowed down.
3. **A scheduled CI job can't make that first pull.** The template stops the job at 60 minutes,
   and a full pull's checkpoint (`.snagentic/<name>/`) stays on the hosted runner, so it would
   start over on every run. The guide now says to make the first pull of a large instance once
   from a workstation with `pull --publish` (#261).
4. **Two 2.20.0 defects, fixed in 2.20.1 (#259).** Every read-only command that connects failed
   (`context.connections.open is not a function`). The first pull after an upgrade re-scans the
   mirror for new secret patterns and read each file by path, which git resolves by scanning
   every folder on the way: 4 ms a file here (a folder of 205,751 files), about 80 minutes, against
   0.08 ms by object id.
5. **`--verify` earns its cost on a long-lived mirror.** The incremental workspace's mirror, kept
   since 2026-10-27 through several releases, lacked 215 records and held 9 the instance no longer
   has. Repairing them took 1,216 requests, compared with 7,445 for a new full pull.
6. **Every read command pays about 6 s on this mirror.** `find`, `describe` and `status` spend
   most of it in system calls (about 35 s of system CPU each) checking 1.18 million working-tree
   files; `git status` alone takes as long. `core.fsmonitor` made no difference with Apple Git.
7. **Memory stays under 1.5 GB.** The full pull peaked at 671 MB; `--verify` at 1.4 GB.

## Not changed, and why

- **Skipping the empty last page of a one-page listing** would save up to one request per class
  (2,880 of 7,445 in the full pull), but a listing ends only on an empty page because ACLs shorten
  pages (ADR-0016). Saving 40% of a once-only run doesn't justify weakening that.
- **Replacing table counts with a cheaper probe**: the count requests are 49 of `--verify`'s
  1,216 and a negligible share of its server time.

## Follow-ups

| # | Item | Plan |
|---|---|---|
| 1 | Read commands spend about 6 s checking the working tree on a 1.18M-file mirror (finding 6) | Measure where the knowledge index's freshness check spends its time; if it walks the working tree, compare the mirror commit id instead |
| 2 | A first full pull in CI on a large instance (finding 3) | Documented (#261). If teams need CI-only setup, cache the checkpoint between runs |
| 3 | A read-only credential on this instance (D5) | Repeat the full pull with a `snc_read_only` user to compare ACL time |
