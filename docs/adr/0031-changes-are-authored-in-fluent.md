# 0031. Changes are authored in Fluent; the mirror is read-only

- Status: Proposed (decision held until spikes F1–F4 of spec 008 pass)
- Date: 2026-10-16
- Requirements: G1, ASR-01, ASR-02, ASR-03, ASR-05, ASR-13
- Supersedes, when accepted: the editing half of 0025 and 0017 (YAML records as the authoring
  format). Generalizes 0028 (flows in Fluent). Replaces the writers of 0029 and 0030, and keeps
  their platform findings
- Evidence: `specs/008-fluent-authoring/analysis.md`

## Context

The product owner asked to move all authoring to ServiceNow's SDK (Fluent), so every change
travels one way, recorded as the platform records it, with the tools ServiceNow provides and its
agents use (2026-10-16).

Today there are two authoring formats:

- YAML records, written through the Table API or through snagentic's own copies of the SDK's
  formats;
- Fluent, for flows.

ADR-0030's own "Alternatives" rejected a Fluent rewrite. Its reason was that Table API writes
were already recorded. The owner weighs consistency higher, and the SDK has grown since:

- about 70 typed APIs, and `Record()` for any other table;
- `Now.del` for deletions;
- `$override` for fields the APIs don't expose, `sys_domain` included;
- global applications;
- offline `transform` of update XML.

## Decision

1. **Fluent source is the only authoring format.** Each scope, global included, has one
   `configuration` project under `source/<scope>/`. Developers and agents edit only those
   projects.
2. **The mirror stays, read-only.** Pull keeps writing it unchanged, for audit, search, advise and
   the base check. Editing it is refused (`check`, hooks, gate).
3. **`adopt` brings records into source.** It renders the record's update XML from the mirror,
   runs the SDK's offline `transform`, and then builds the result. It refuses when the build
   differs from the mirror in any field.
4. **One write route:** the SDK builds every record, and push loads each scope's build with
   `fluent/load` into the batch's update set. It then publishes flows and verifies capture.
   The Table API write path and snagentic's own record writers are removed.
5. **Instance edits are drift.** Integrate reports adopted records that changed on the instance.
   `adopt --refresh` re-transforms them in git, so the change merges with local work like any
   other.
6. **The gate checks the build and the source:**
   - record checks run on the built records;
   - script rules run on the source scripts, with context from the built record.
7. **Held until spec 008's spikes pass on pdi2:**
   - F1, brownfield round trip;
   - F2, load and capture of records the project doesn't own, ACLs included;
   - F3, domains and deletions;
   - F4, drift.

   If F1 or F2 fails for records the project doesn't own, those records stay YAML through the
   Table API, and everything else moves.

## Consequences

- **One format and one route.** What push writes is what the SDK builds, and it is recorded
  as the platform records it.
- **Workspace format changes,** in a major release (2.0.0) with a migration command.
- **Most of delivery is rewritten,** along with about half of governance and the accelerators.
  Sync and knowledge are unchanged.
- **snagentic depends more on the SDK.** Its version is pinned, and each upgrade reruns the live
  contract tests (ADR-0028).
- **Developers read and write TypeScript instead of YAML.** Diffs of a field stay readable.

## Alternatives considered

- **Keep YAML for recorded classes; load only what isn't recorded (ADR-0030).** It works today
  and is tested, but it keeps two formats and our own copies of the SDK's writers. The owner
  prefers one consistent route.
- **Mirror the instance as Fluent, through `transform`.** Rejected:
  - Fluent describes what a project owns, not an instance's 1,503 classes;
  - transform of a whole instance is heavy on the instance (ADR-0016), and overwrites rather
    than merges.
- **`now-sdk install` of application packages.** Rejected: it doesn't record update sets, and
  global configuration isn't an application.
