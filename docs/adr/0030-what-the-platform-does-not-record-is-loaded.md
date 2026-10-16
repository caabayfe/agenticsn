# 0030. What the platform does not record is loaded as the update it records

- Status: Proposed
- Date: 2026-10-16
- Requirements: ASR-01, ASR-02, ASR-13, ASR-16
- Amends: 0025 (items 3 and 4: form layouts and related lists), 0029 (generalizes it)
- Relates to: 0028 (the `fluent/load` route), 0027 (domains), 0016 (instance load)
- Evidence: `specs/007-capture-everything/plan.md` (assessment), spike S15
  (`tools/spikes/s15-composite-loads/`), and the end-to-end runs in this ADR's pull request

## Context

ADR-0029 found that the platform never records a list layout written through the Table API,
and delivered lists through `fluent/load`. The product owner then asked which other mechanisms
should move to the Fluent route.

A table is recorded in update sets when its collection dictionary entry says so. Reading that
attribute for the 1,503 classes in pdi2's mirror gives the full list:

| Attribute | A Table API write | Classes push writes |
|---|---|---|
| `update_synch=true` | recorded | everything else push writes |
| `update_synch_custom=true` | never recorded: only the layout editors record one composite update | lists, form sections, related lists |
| `update_synch=false` | never recorded | scheduled jobs (and rarer classes) |

A census of the Access Review application, which push built, and a capture matrix pushed with
1.8.0 agreed. They also showed that push reported a form section as captured when it was not:
the check looked for the form's update.

## Decision

1. **Push picks each write's route from the instance's own attribute.** It reads the planned
   classes and their parents from the dictionary at plan time. Recorded classes keep the Table
   API. A record of a class that is not recorded is loaded through `fluent/load` as its update.
   The plan marks such changes "loaded".

2. **Layouts are delivered whole, one update each:**

   | Layout | Update | Format |
   |---|---|---|
   | list | List Layout | the SDK's `List()` |
   | form section and its fields | Form Layout | the SDK's `Form()` section writer |
   | form and its sections | Form Sections | the SDK's `Form()` form writer |
   | related lists | Related Lists | the platform's own, as pdi2 recorded it (no SDK plugin) |

   A form's Table API writes are recorded, but delivering it whole lets a section leave a
   form, and keeps every layout on one route. A removed row is removed. Sections load before
   the forms that show them.

3. **One record is loaded in the SDK's `Record()` form**, with all of its fields, never one
   pull withholds.

4. **Every format is checked.** A contract test builds the same records with the embedded SDK
   and requires the same bytes. Related lists are compared with the update pdi2 recorded.

5. **Every load stamps the record it changes as a write would:** `sys_mod_count` as pulled
   plus one, and `sys_updated_on` the push time. `fluent/load` otherwise keeps the record's old
   values, and the incremental pull never sees the change.

6. **Capture counts only what the load recorded.** Push reads the update entries under the name
   before loading. Only a new or changed entry in the batch counts as captured.

7. **The platform's rules are enforced before any write:**
   - An existing form section's header, title and roles never reach its update; they do on
     creation. The plan refuses changing them on an existing section.
   - Loading a new section adds it to its form on the instance. So a scope's layouts are
     checked against the pull before its first write, not between loads.

8. **A related lists record is identified by its table, view and domain.** The platform
   recreates it under a new sys_id on every save, with no deletion record, and its editor does
   too. Therefore:
   - Pull removes the record a new one replaced, once the instance confirms it is gone. That is
     one request, made only when such a record is created.
   - Integrate pairs a pushed related list with the instance's replacement when its entries
     match, for an edit and for a creation.
   - A removed file beside its replacement is not a delete.

9. **Pull downloads changed records by sys_id alone.** On a table with domain overrides (form
   sections), any other condition makes the instance hide records of other domains.

## Consequences

- Everything push writes travels with the batch. A write the platform would not record is
  refused in the plan, or reported as not captured; it is never reported as captured.
- Push needs `fluent/load` for layouts and unrecorded classes. ADR-0028's live contract test
  covers it.
- A related list's sys_ids change on every push. That is the platform's behaviour, and the
  mirror follows it.
- The plan reads the dictionary for the classes it writes: one or two requests per plan.
- Not covered: moving the batch to a second instance; a full pull still lists each class by
  `sys_class_name`, so it misses form sections in other domains. That predates this ADR and
  needs its own change to how a full pull lists.

## Alternatives considered

- **Rewrite everything as Fluent source.** Rejected: the platform already records about 1,450
  of the classes push writes. Moving them would replace the YAML mirror (ADR-0007, 0017) and
  gain nothing.
- **Build each layout with the embedded SDK from generated source.** Rejected for the reasons in
  ADR-0029; the contract tests keep the output equal to the SDK's.
- **Related lists one record per row, as the SDK's `Record()` writes them.** Rejected:
  `fluent/load` refuses to update an entry ("invalid scope"), as entries have no scope.
- **Leave the instance's own timestamps after a load.** Rejected: the incremental pull would
  miss the change, and the next push would stop on a record that looks changed.
