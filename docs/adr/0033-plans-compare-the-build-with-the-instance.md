# 0033. Plans compare the build with the instance; owned records have a base

- Status: Accepted (product owner, 2026-10-16)
- Date: 2026-10-16
- Requirements: ASR-02 (write safety), ASR-10 (reviewability), ASR-13 (determinism)
- Relates to: 0031 (Fluent authoring), 0030 (stamping), 0027 (domains), spec 004 (plan and push)
- Plan: `specs/008-fluent-authoring/plan.md`

## Context

Under ADR-0031, a `configuration` project's build holds every record the project defines, not
only the changed ones. S16 showed three facts:

- a build can set fields the developer never wrote, through SDK defaults and losses;
- the same source can build different placeholder ids;
- an instance edit to an adopted record isn't visible in source until it is refreshed.

A diff of source files would hide the first and last. Loading the whole build would overwrite
instance edits.

## Decision

1. **A plan is the effect on the instance.** Plan builds the changed projects and compares each
   built record with its mirror copy, after a normalization the platform agrees with: natural
   keys for child rows, layouts as ordered element lists, placeholder ids by view name. A field the
   build omits is unmanaged: a load leaves it untouched (S17). Only built files with a real
   difference are loaded.
2. **Each owned record has a base,** per development instance, in
   `source/<scope>/snagentic.ledger.yaml`. The base is the mirror hash when the record was
   adopted, refreshed, or confirmed after a push.
3. **Every changed field is classified:**
   - **authored:** the builds at the merge base and at head differ;
   - **drift:** the mirror moved away from the base. Plan refuses, and names `adopt --refresh`;
   - **residue:** a known SDK loss already present at adoption. Listed as "the load also sets",
     and waivable;
   - **deletion:** a `Now.del`.

   A difference that is none of these is `unexplained` and refuses.
4. **The base check at push** compares the instance's current hash with the ledger base. This
   replaces three mechanisms: the YAML base hash, child-row versions and layout versions.
5. **Integrate advances bases.** A pushed record whose mirror copy equals its build is confirmed,
   and its base advances in the same commit as the merge.
6. **The plan id** covers:
   - the mirror commit;
   - each record's identity and base;
   - a digest of each changed field;
   - the normalized digest of each loaded file;
   - the gate.

## Consequences

- Reviewers see what the instance will change, side effects included.
- Instance edits can't be lost: the plan refuses them until git has merged them.
- A record already equal to the instance isn't loaded, so re-running a push is harmless.
- Correctness rests on `normalize`. Every rule needs a golden fixture from a real instance, and an
  unknown difference refuses instead of loading.
- A committed ledger file per project changes on every adoption and push confirmation.

## Alternatives considered

- **Diff source files only.** Simple, but it hides SDK side effects, and it can't detect drift.
- **Load the whole build every time.** Overwrites instance edits, and records unchanged records
  in the update set.
- **Keep bases in `.snagentic/` (not committed).** Teammates and CI would not share them, and
  branches would disagree.
