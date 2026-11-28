# 0060. Records of tables without an application scope change as data

- Status: Accepted (product owner, 2026-11-28: "go with A")
- Date: 2026-11-28
- Requirements: G1, ASR-01, ASR-16
- Relates to: 0031 (Fluent source delivered by push), 0033 (plan by unit), 0050 (unfinished
  deliveries), 0026 (accelerators as content packs)

## Context

The itsm pack's business hours moved from 8–17 to 9–18 (incident guide, Q01). The span holding
the hours, a `cmn_schedule_span`, is Fluent source in `sla-common`. Its install on pdi15 stopped
part way: the load answered HTTP 400 "Found cmn_schedule_span_<id>.xml with invalid scope.", after
the schedule beside it had been written, leaving an unfinished delivery.

A spike on pdi15 (2026-11-28, throwaway schedule and span in their own update set, since removed)
sent one span through each route:

| Route | Result |
|---|---|
| `fluent/load`, create | 200, record created |
| `fluent/load`, update, file as the SDK builds it (with `sys_scope`) | 400 "invalid scope" |
| `fluent/load`, update, without `sys_scope` | 400 "invalid scope" |
| `fluent/load`, delete (`action="DELETE"`) | 400 "invalid scope" |
| Table API update, update set current | applied and captured |
| Table API delete | applied, **not** captured in the update set |

`cmn_schedule_span` extends `business_calendar_span`, a root table: no table in its ancestry
declares `sys_scope`. `cmn_schedule` inherits `sys_scope` from `sys_metadata` and loads in every
operation. For the platform, a record without an application scope is data, not an application
file: the load can add one and cannot change or remove one.

## Decision

1. **Plan refuses to update or delete a record whose table has no application scope.** For each
   unit it would load or delete, plan reads the table's ancestry (`sys_db_object`, one level per
   request) and the dictionary entries that declare `sys_scope` in it. A table the instance
   describes, with no `sys_scope` anywhere in its ancestry, is refused: the unit is a problem
   naming the table and saying to change it as data, and the plan is not ready. Nothing is written,
   so no push stops part way on such a record.
2. **Creates stay.** The platform accepts them, so a pack can still ship such a record as source
   the first time.
3. **Only complete evidence refuses.** A table the instance does not describe, or whose ancestry
   it does not fully name (a parent given by sys_id alone), is left to the load: a table yet to be
   created, or a reply an access rule shortened, is not refused on no evidence.
4. **A pack ships such records as data.** An accelerator's data entity (business key, import set)
   loads them on every install, as holidays already are. Changing them later is a data load.
5. **Reads:** the check runs only when the plan updates or deletes something: a plan with no
   changes reads nothing more (ADR-0016).

## Consequences

- The pack's working hours are not promoted by update set: each instance's install loads them,
  like the schedule's holidays. A client promoting by update set gets the schedule (an application
  file) and loads its hours as data.
- An adopted record of such a table can be read, explained and validated as source, and plan says
  why it cannot change it, instead of a push failing after other units were written.
- The refusal holds whatever the build writes: the spike showed removing `sys_scope` from the file
  does not help, so no SDK patch is made.

## Alternatives considered

- **Route such writes through the Table API** (update set made current, as a push already does for
  preferences): updates are captured, deletes are not. snagentic would have to write the delete
  into the update set itself, which relies on undocumented platform behaviour, and a client
  promoting by update set would silently miss it.
- **Strip `sys_scope` from the built file:** the spike refused the update without it too.
- **Retire the old record and create a new one:** the retirement is a delete, refused as well.
