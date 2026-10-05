# S8. Committing the mirror to git

- Date: 2026-10-05
- Affects: ADR-0007 (mirror branch), milestone M3
- Verdict: **stream pulls into git with `git fast-import`; keep no mirror work tree.**

## Question

How should a pull commit up to ~280,000 records to `servicenow-remote/<name>`?

## Method

`tools/spikes/s8-git-commit/fast-import.ts` renders all 279,983 PDI records (flat layout,
own YAML style) and streams them as blobs plus one commit into `git fast-import`. It then
checks the branch out once, as `integrate` will, and runs `git status`. It is compared with
spike S7's work-tree approach (write files, `git add`, commit).

## Results

| Full mirror: 279,983 records, 411,321 files | Work tree + `git add` (S7, v1) | `git fast-import` |
|---|---|---|
| Time to a commit | 65 s write + 268 s add + 10 s commit | **30.4 s** (rendering included) |
| Repository size | 1.6 GB, loose objects | **170 MB**, packed |
| Extra disk for a mirror work tree | ~2 GB | **none** |
| First checkout into a workspace | n/a | 22.7 s |
| `git status` after checkout | 1.2 s | 1.4 s |

## Decision

- Pulls stream records straight into `git fast-import`; there is no mirror work tree.
- Progress is committed to a private ref (`refs/snagentic/pull/<name>`) after every class,
  before the pull checkpoint records the class as done, so a resumed pull continues from
  exactly what git holds.
- The finished pull is one commit on `servicenow-remote/<name>` whose parent is the
  previous pull; progress commits never appear in the branch history.
- Incremental pulls (M4) commit only changed files on top of the previous mirror commit.
