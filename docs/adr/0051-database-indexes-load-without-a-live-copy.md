# 0051. Database indexes load without a live copy; their capture is their read-back

- Status: Proposed (2026-11-10, for the product owner)
- Date: 2026-11-10
- Requirements: G1, ASR-02, ASR-16
- Amends: 0033 (item 1, the live copy; item 4, plan; item 6, read-back)
- Evidence: pdi6 answers `GET /api/now/table/sys_index` with 403 "Failed API level ACL
  Validation" to admin (2026-11-10); the ITSM pack's install on pdi3 stopped on a Table's unique
  index (2026-11-04); SDK 4.14 `table-plugin` writes each `index` of a `Table()` as a `sys_index`
  record named `sys_index_<table>_<columns>`, as the platform's update namer does

## Context

A Fluent `Table()` may declare its database indexes (`index: [{ name, element, unique }]`). The
SDK writes each as its own `sys_index` unit. ADR-0033 reads every candidate unit's live copy
before the plan and after the load. The instance's REST API refuses `sys_index` to every user,
admin included, so the read throws and the plan stops: a pack cannot ship an index on its own
tables, and the ITSM pack lists its indexes for an administrator to create by hand.

## Decision

1. **Tables the REST API never serves** are named in the unit specs (`readable: false`); today
   only `sys_index`. Their units are never read: no request is sent for them.
2. **Plan:** such a unit has no live copy. A candidate (its build moved from the ledger, or it is
   not in the ledger) is a **create**. A `Now.del` of one is refused as unsafe: nothing could show
   the record is there, or gone after the load; the administrator deletes it on the instance.
3. **Push:** its read-back is its capture. Recorded in the target update set under its update
   name, it counts as applied and its ledger entry is written with the instance version `unread`;
   not recorded, it is reported not captured and not applied, and the next plan creates it again.

## Consequences

- A pack can declare indexes on its own tables; the install no longer stops on them.
- Drift on an index (someone changes or drops it on the instance) is not seen: the ledger alone
  decides, as for a compiled flow. An index is a definition nobody edits by hand.
- An index on a platform table is still left out of packs: creating one on a large table is a
  database change an administrator schedules, not a side effect of an install.
- Owed on a development instance: a load of a pack table with a unique index, then its capture
  and the index on the table (System Definition > Tables > Database Indexes).

## Alternatives considered

- **Grant the integration user read on `sys_index`.** The refusal is at the API level, before
  record ACLs, and admin meets it too: no role the install user could be given lifts it.
- **Catch the refusal and treat the copy as unknown.** Every plan would send a request that is
  always refused, and a refusal on any other table would be hidden too.
- **Read the index through another table** (`sys_update_version` by update name). It shows that
  an update was recorded, which the capture check already shows, not what the database holds.
