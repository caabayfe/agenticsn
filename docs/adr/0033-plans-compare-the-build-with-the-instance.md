# 0033. Plans compare the build with the instance; owned records have a base

- Status: Accepted (product owner, 2026-10-16). Revised the same day, before any code: the
  comparison reads the instance's live copy, not the mirror (see Context)
- Date: 2026-10-16
- Requirements: ASR-02 (write safety), ASR-10 (reviewability), ASR-13 (determinism), ASR-16
- Relates to: 0031 (Fluent authoring), 0032 (the SDK's connector), 0030 (stamping), 0027 (domains),
  spec 004 (plan and push)
- Plan: `specs/008-fluent-authoring/plan.md`

## Context

Under ADR-0031, a `configuration` project's build holds every record the project defines, not
only the changed ones. Spikes S16 and S17 showed:

- a build can set fields the developer never wrote, through SDK defaults and losses;
- a field the build omits is left untouched by a load (S17);
- the platform identifies what a load replaces by **update name**. This is the unit of a load:
  - a record (`sys_script_include_<sys_id>`);
  - a column (`sys_dictionary_<table>_<column>`);
  - a whole form section, with its elements;
  - a list, with its columns.
- an instance edit to an adopted record isn't visible in source until it is refreshed.

**Why the live copy, not the mirror.** The first version of this ADR compared the build with the
mirror. The mirror doesn't hold everything a build writes:

- pull skips derived classes such as field labels (`sys_documentation`) on purpose;
- Default-domain form sections are missing (ADR-0030's open bug);
- the mirror is only as fresh as the last pull.

A plan compared with the mirror would show phantom changes. Plan is already online, for update
sets and collisions. Reading the live copies of the units it may load costs a few batched,
indexed requests.

## Decision

1. **The unit is the update.** A built file is one unit, named by its update name. The instance's
   copy of a unit is read live:
   - its record, by sys_id or by the keys the platform coalesces on (dictionary entries, labels,
     choices);
   - for composites, its child rows: a section's elements, a list's columns, a related list's
     entries.
2. **One comparison** serves `adopt`, plan and push. Both sides are normalized:
   - ignored platform fields;
   - fields the build omits are unmanaged;
   - child rows matched by the platform's keys;
   - layouts compared as ordered element lists;
   - placeholder ids resolved by view name;
   - line endings.

   A difference is either authored, or a **known SDK loss** from a catalogue tied to the SDK
   version.
3. **The ledger.** `source/<scope>/snagentic.ledger.yaml` is committed. It records, per
   development instance and per unit:
   - the build's hash;
   - the instance copy's hash;
   - the known losses accepted at that point (residues).

   Entries are written when source and instance agree:
   - `adopt` and `adopt --refresh` write them in their commit;
   - push writes them after it has read back what it loaded, in one commit of the ledger file.
4. **Plan:**
   - **candidates:** units whose build hash differs from the ledger's, and units not in the
     ledger;
   - **read** the candidates' live copies;
   - **already equal** to the build: nothing to load;
   - **instance hash equals the ledger's:** load. The difference is ours. Residues are listed as
     "the load also sets";
   - **instance hash differs from the ledger's: drift.** Refuse, naming `adopt --refresh`;
   - **not in the ledger and present on the instance:** refuse, naming `adopt`. Source never
     overwrites a record it hasn't adopted;
   - **not in the ledger and absent:** create.
5. **Deletion.** A `Now.del` deletes when the record exists. A ledger entry with no definition in
   the build and no `Now.del` is a blocking finding.
6. **Push** re-reads each unit just before its scope's load, and refuses if the hash moved since
   the plan. After the load, it reads the units back and requires them to equal the build. This
   is the capture check for content; the update set check stays.
7. **The plan id** covers:
   - each unit's update name;
   - its ledger and live hashes;
   - the normalized digest of its built file;
   - the gate.

## Consequences

- Reviewers see what the instance will change, side effects included.
- Instance edits can't be lost: plan refuses until git has merged them through `adopt --refresh`.
- A unit already equal to the instance isn't loaded, so re-running a push changes nothing.
- The ledger is per branch, so switching branches can't revert another branch's push. The other
  branch's change shows as drift.
- Plan and push no longer depend on what pull covers. The mirror serves search, audit, advice and
  choosing what to adopt.
- Correctness rests on the normalization. Every rule needs a golden fixture from a real
  instance, and an unknown difference refuses instead of loading.
- Push makes one commit, of the ledger file, on the current branch.

## Alternatives considered

- **Compare with the mirror.** The first version of this ADR. Rejected for the gaps above.
- **Diff source files only.** Simple, but it hides SDK side effects and can't detect drift.
- **Load the whole build every time.** It overwrites instance edits, and puts unchanged records
  into the update set.
- **Keep the ledger in `.snagentic/`, not committed.** Switching branches would then revert
  another branch's push without warning.
- **No ledger: use the build at the merge base as the base.** This works on feature branches.
  On a branch whose unpushed commits are already in the base, an authored change would be
  classified as drift.
