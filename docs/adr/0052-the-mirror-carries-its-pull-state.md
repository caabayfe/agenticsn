# 0052. The mirror carries its pull state, so any clone continues a pull from git

- Status: Proposed (2026-11-10, for the product owner)
- Date: 2026-11-10
- Requirements: ASR-06, ASR-07, ASR-08, ASR-16
- Amends: 0004 (team mode: how developers get and refresh the mirror), 0014 (what `.snagentic/`
  holds)
- Evidence: enterprise-readiness audit, 2026-11-10 (spec 014, §2). Measured on `main` 6b458a6:
  - `pull` decides between incremental and full from local files only (`registry/pull.ts:69-71`);
  - an incremental pull refuses without the local state and catalog (`pull-incremental.ts:186`);
  - `status` sends a developer who never pulled to `snagentic pull` (`sync-phase.ts:16-25`);
  - every command reads `refs/heads/servicenow-remote/<name>` only;
  - relisting a child-table family removes the files of owners it no longer sees
    (`incremental-children.ts:168-195`);
  - a full pull of the PDI takes 29 min and 5,180 requests (`docs/reports/pull-baseline-pdi.md`).

## Context

ASR-06 says an instance is pulled once, and git distributes the result. Under ADR-0004's team
mode, developers get the mirror with `git pull`. The owner wants it to work this way: one
designated pull per instance. Developers start from what git already has, and any pull of
their own is only the change since then.

That doesn't work today, because the state a pull continues from isn't in git:

- the watermark, fingerprints, inventory signatures, unreadable tables, redaction versions and
  catalog all live in `.snagentic/<name>/`, which is never committed;
- a clone that fetched the mirror has no state, so its first `pull` is full;
- a developer who pulled last week continues from last week, whatever git holds;
- each pull commits on the local mirror branch, so mirror histories split between clones;
- the designated puller can't change (a new laptop, a CI runner that starts empty) without a
  second full pull;
- without the catalog, `describe` loses table inheritance and `adopt` builds its secret-field
  catalog from the units' own tables only;
- `status` and the skills steer every developer to pull from the instance.

A second thing makes the mirror depend on who pulled: what a listing returns depends on the
user's read access. Relisting a child family removes the files of owners it no longer sees. So
a pull by a user with less access than the one who wrote the mirror would delete records that
user can't read.

## Decision

1. **Each mirror commit carries the state it was pulled with.** The commit that writes the
   records also writes these files:
   - `instances/<name>/pull/state.yaml`: watermark, last full pull, fingerprints, inventory
     signatures, unreadable tables, hidden counts, redaction and secret-scan versions, the
     instance user that pulled, and the snagentic version;
   - `instances/<name>/pull/catalog.yaml`: the catalog, after the same secret scan as every
     file a pull writes (ADR-0035).

   The state is then a function of the commit, as ADR-0004 already requires of derived data.
   `.snagentic/<name>/` keeps only what belongs to one clone: the checkpoint of an interrupted
   pull, the search index, locks, journals and caches. A workspace that pulled with an earlier
   version moves its local state into its next pull commit; it doesn't pull everything again.

2. **A pull starts from the newest mirror, wherever it is.** An instance profile can name a
   shared mirror: a git remote, `origin` by default when team mode is on. A pull then:
   1. fetches `servicenow-remote/<name>` from that remote;
   2. continues from whichever of the local tip and the shared tip has the later watermark;
   3. when that is the shared tip, moves the local branch to it. Local mirror commits are never
      published (item 5): the instance is the source, and the shared commit already holds what
      they held.

   A clone or CI runner with no local state continues incrementally from the fetched commit.
   Without a shared mirror (solo mode), nothing changes.

3. **A fresh mirror costs the instance nothing.** If the starting commit is younger than the
   profile's `maxAge` (proposed default: 15 minutes), the pull sends no request to the instance
   and reports the age of the mirror. `--now` pulls anyway. With a scheduled central pull,
   most developer pulls are a git fetch.

4. **Only the user who wrote the mirror can remove from it by absence.** The state names the
   instance user that pulled it. A pull by another user:
   - adds and changes records;
   - removes only what the instance's own delete records name;
   - never removes a file because its own listing didn't return it.

   One developer's narrower read access can't delete records from their mirror, or from the
   branches they integrate it into.

5. **Publishing is explicit and fast-forward only.** `pull --publish` pushes the mirror branch
   to the shared remote after the pull. It is used by the scheduled CI pull or the designated
   puller.
   - It is refused when the pulling user isn't the one the shared state names, except on a
     branch that is new.
   - It is refused when the push isn't a fast-forward. Then the pull fetches, continues from
     the newer commit and tries once more.

   The guide asks teams to protect `servicenow-remote/*` so that only the puller's identity can
   push it.

6. **Git-only developers are first-class.**
   - `integrate <name>` first fast-forwards the local mirror branch from the shared remote.
   - `status` reports the shared mirror's age and whether it is ahead of the local branch. It
     suggests `integrate`, and suggests `pull` only when the mirror is older than `maxAge`.
   - The skills follow `status`. An agent no longer offers a pull just because this clone never
     pulled.

7. **State from git is data, not trust.**
   - `state.yaml` and `catalog.yaml` are validated on read.
   - A watermark later than the instance's own clock is refused, because it would hide changes.
   - The redaction and scan versions are checked as they are today. A clone whose snagentic
     applies a newer policy rescans and re-reads what the policy needs, before it uses the
     mirror.

## Consequences

- The cost of a full pull is paid once per instance, not once per clone. New laptops, new
  developers and stateless CI runners all continue incrementally.
- The designated puller can change at any time. The state moves with the branch, not with a
  laptop.
- Developer pulls inside `maxAge` send no requests. ASR-16's no-change budget then applies once
  per schedule, not once per developer.
- `describe`, `adopt` and the knowledge tools get the same catalog on every clone.
- Each pull commit also changes `state.yaml`, a small file, and `catalog.yaml` changes only when
  the dictionary does.
- Anyone who can push `servicenow-remote/*` could hide changes by advancing the watermark, as
  they can already edit the mirror's files. Branch protection is part of team mode. Item 7
  catches a watermark in the future, not one that was moved by hand.
- `pull` and `integrate` call the git remote, so they need the developer's git credentials.
  That is a new network call to document.
- The mirror shows the instance as the publisher's user sees it. The team guide says what read
  access that user needs.
- Owed:
  - an end-to-end test with two clones and a stateless runner (spec 014, T1);
  - the team-mode guide and a scheduled CI pull template (T2);
  - a check that a committed `instance.yaml` works with each developer's own credential (T2).

## Alternatives considered

- **Keep the state local, and have CI cache `.snagentic/`.** It helps only the CI puller. A
  cache can drift from the branch, and nothing records which commit a state belongs to.
  Developers would still pull everything.
- **Rebuild the state from the mirror's files.** The newest `sys_updated_on` in the files
  doesn't account for deletes, unreadable tables or hidden rows. Fingerprints can't be rebuilt
  from files, and the catalog would need a scan of every file on each clone.
- **Keep the state in git notes.** Notes aren't fetched by default, most git hosts don't show
  them, and they would need their own protection and merge rules, for the same content.
- **Every developer pulls from the instance with their own state** (today). It costs a full
  pull per clone, then N no-change pulls per interval, and a separate mirror history for each
  developer.
- **A central mirror service.** ADR-0004 rejected it for v1: it reimplements what git already
  does.
