# Full-pull baseline: PDI (milestone M3)

- Date: 2026-10-05
- Instance: `dev312411` (PDI, US data center), measured from Europe
- Command: `snagentic pull pdi` (first full pull), then `snagentic integrate pdi`
- Build: commit after `fix(sync): serialize concurrent writes…`

## Result

| Measure | Value |
|---|---|
| Records | **463,316** in 2,224 classes |
| Child rows | 131,405 (flow logic, form and list layouts, workflow structure) |
| Operational inventory | 1,414 rows |
| Files in the mirror | 619,597 |
| Duration | **1,728 s (29 min)** for the resumed run; the interrupted first attempt had completed 61 classes in 28 s |
| Requests to the instance | **4,995**, 0 retries |
| Semaphore wait, total | **4.2 s** across the whole pull |
| Peak memory | 1.1 GB resident (target < 1 GB, see follow-ups) |
| Mirror commit | one commit on `servicenow-remote/pdi` |
| Repository after the pull | 585 MB packed; **230 MB after `git gc`** (11 s) |
| `integrate` into the workspace | **41 s** for 619,597 files |
| `git status` afterwards | 4 s |
| Workspace size on disk | 2.7 GB |

## Findings

1. **Gentle on the instance.** Across 29 minutes, the integration requests spent 4.2 s in
   total waiting for worker semaphores, and nothing needed a retry. The adaptive scheduler
   never had to slow down.
2. **Resume works for real.** The first attempt crashed (a concurrency bug, fixed in the
   same branch); the relaunch continued from the progress committed to git instead of
   starting over.
3. **463,316 records, not v1's 280,000**, because nothing is excluded any more:
   `sys_dictionary` (135,297 field definitions) and `sys_security_acl_role` (49,483 ACL role
   requirements) were summarized in v1 and are now mirrored as records (ADR-0017).
4. **79 tables are not readable even by `admin`**, including `sys_plugins` and
   `sys_store_app`, the KMF and secrets applications, error-handling and generative-AI
   configuration. They are listed in the pull summary. `v_plugin` is readable, so the plugin
   inventory is available.

## After the hardening pass (same PDI, `pull pdi --full`)

| Measure | Baseline | After hardening |
|---|---|---|
| Duration | 1,728 s | 1,751 s |
| Phases | not measured | catalog 15.8 s, **records 1,530.8 s**, child rows 197.2 s, inventory 4.5 s, commit 2.7 s |
| Requests / retries | 4,995 / 0 | 5,180 / 0 |
| Semaphore wait, total | 4.2 s | 4.3 s |
| Peak concurrency reached | not measured | 4 (the scheduler's maximum) |
| Time spent in requests | not measured | 3,143.5 s (requests overlap) |
| Peak memory, physical footprint | 920 MB | **457 MB** |
| Peak memory, resident size (sampled) | 1.1 GB | 1,048 MB |
| Repository after a second full pull | 230 MB after manual gc | 291 MB → 291 MB, no garbage left |

**Where the time goes.** The pull is latency-bound: requests average 0.61 s
(3,143.5 s / 5,180), mostly the round trip between Europe and a US-hosted PDI, with about
two requests in flight on average. That accounts for the records phase almost exactly;
rendering, YAML and git take a few seconds. Options to go faster all add requests in
flight or skip requests, so they belong with M4's measurements: skipping classes that
aggregate counts show to be empty (~740 of 2,224 classes, one request each), and
letting the controller reach its maximum sooner.

## Follow-ups

| # | Item | Plan |
|---|---|---|
| 1 | Peak memory 1.1 GB, over the 1 GB target | **Done:** child tables stream into their groups; the mirror tracks record bases only. Physical footprint 920 → 457 MB; sampled resident size 1,048 MB (includes memory the runtime has reserved but not returned) |
| 2 | The repository needs a repack after a full pull (585 → 230 MB) | **Done:** a finished pull repacks; fast-import keeps every batch packed |
| 3 | An interrupted `fast-import` leaves temporary pack files | **Done:** abort stops git cleanly and removes the session's temporary packs |
| 4 | `init` leaves the workspace's own files untracked, so `git status` lists them | **Done:** `init` makes an initial commit |
| 5 | Where the 29 minutes went is not broken down | **Done:** per-phase timings, peak concurrency and request time are reported (see above) |
| 6 | `sys_store_app` is unreadable for admin | Plugins list (M6) relies on `v_plugin`; store applications from `sys_scope` |
