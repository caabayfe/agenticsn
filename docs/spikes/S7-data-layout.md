# S7. On-disk data layout

- Date: 2026-10-05
- Question from: the product owner ("optimized data structure")
- Affects: ADR-0007 (disk format), ADR-0014 (workspace layout)
- Verdict: **recommend layout C (flat)**. Needs your decision.

## Question

Which on-disk layout makes syncs, git and agents fastest, without losing readability?

## Corpus and method

- The full v1 mirror of the PDI on this machine: **279,983 records**. As written by v1:
  714,945 files in 314,826 folders, **773 MB of content taking 3.1 GB on disk**. Every
  small file occupies at least one 4 KB block.
- `tools/spikes/s7-data-layout/compare-layouts.ts` streams every record into each
  candidate (in the new YAML style, ADR-0015), then measures disk use and git, configured
  as `snagentic init` configures it (`feature.manyFiles`, untracked cache, fsmonitor).
  "After 100 changed records" edits 100 records spread across the instance, like an
  incremental pull does.

| Layout | One business rule on disk |
|---|---|
| **A, v1** | `sys_script/<name>--<id>/` with `_meta.yaml`, `record.yaml`, `script.js` |
| **B, merged meta** | `sys_script/<name>--<id>/` with `record.yaml` (identity under `_meta`), `script.js` |
| **C, flat** | `sys_script/<name>--<id>.yaml` (identity under `_meta`) and `sys_script/<name>--<id>.script.js` |

Per-class bundle files (all records of a class in one YAML) were excluded on purpose:
every edit rewrites a large shared file, and parallel changes to one class conflict.

## Results

| Measured | A: v1 | B: merged meta | C: flat |
|---|---|---|---|
| Files | 714,945 | 434,962 | 434,962 |
| Folders | 314,826 | 314,826 | **12,218** |
| Disk used | 3,157 MB | 2,067 MB | 2,067 MB |
| Content size | 1,042 MB | 1,017 MB | 874 MB |
| Git repository (`.git`) | 4.0 GB | 2.9 GB | **1.6 GB** |
| Initial `git add` | 362 s | 356 s | 268 s |
| Initial commit | 149 s | 142 s | **9.9 s** |
| `git status`, cold / warm | 15.0 s / 337 ms | 14.2 s / 271 ms | **1.2 s / 60 ms** |
| After 100 changed records: `status` / `add` / commit | 1.3 s / 19.7 s / 4.7 s | 1.1 s / 25.4 s / 7.8 s | **0.33 s / 0.79 s / 1.2 s** |

Read and write times were also recorded but are not comparable: the layouts ran one after
another on a busy disk. The initial `git add` will not be how a pull commits; milestone
M3 measures committing through git plumbing (batched blobs or `git fast-import`).

## Findings

1. **Folders, not files, dominate git cost.** Git stores one tree object per folder. A
   folder per record means about 315,000 trees, and every commit rewrites the tree of each
   touched record and its parents. Layout C cuts commits 4–25× and repository size 2.5×.
   That is precisely the pattern of an incremental pull, so **every future sync** benefits,
   not only the first.
2. **Merging `_meta.yaml` into the record** (B, C) removes 280,000 files and 1.1 GB of disk
   (block overhead). Identity stays next to the content, under a `_meta` key.
3. **Disk use is still 2 GB** because of 435,000 small files, mostly out-of-box records. The
   bigger lever is *what* is mirrored. That is open question 1 in the ADR index (default
   mirror scope), separate from layout.

## Costs of layout C

- Large class folders: 40,977 files for `sys_security_acl`, 11,122 for `sys_script`. Fine
  for git, command-line tools and agents; a graphical file explorer is slow on the largest.
- Longer file names: `<name>--<sys_id>.<field>.js`. A record's files sort next to each
  other, so globs stay simple: `**/sys_script/*.script.js`.
- Child rows become `<name>--<sys_id>.children.<table>.yaml` siblings instead of a
  `_children/` folder.

## Recommendation

Adopt **layout C** as workspace layout 1 (no workspace contains synced data yet, so nothing
needs migrating). Record it as an ADR amending ADR-0007 and ADR-0014. Keep the measurement
script, so the decision can be re-checked against a customer mirror.
