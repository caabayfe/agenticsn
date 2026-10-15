# 0029. List layouts are delivered whole, through the Fluent load route

- Status: Proposed
- Date: 2026-10-15
- Requirements: ASR-01, ASR-02, ASR-13, ASR-16
- Amends: 0025 (item 3, for `sys_ui_list` and `sys_ui_list_element`)
- Relates to: 0028 (the `fluent/load` route), 0027 (domains)
- Evidence: spike S14, `tools/spikes/s14-list-layouts/README.md` (pdi2, 2026-10-14), and the
  live test in this ADR's pull request

## Context

ADR-0025 made list layouts editable: push writes a list's columns (`sys_ui_list_element`) one row
at a time through the Table API, then checks that the update set recorded the list.

Spike S14 found that the platform never records those writes. A list layout is recorded only as
one composite "List Layout" update, which the platform writes when the list layout editor saves
the whole list. So every list push since 1.5.0 reached the development instance and nothing else:
the batch moved without its lists, and push reported them as not captured.

S14 also found a route that is recorded. A list layout loaded through `fluent/load` into a named
update set (ADR-0028's route) is recorded there as the platform's own List Layout update. The
user's preferences are untouched. The list keeps its sys_ids when the loaded update carries them.

## Decision

1. **Push delivers a changed list whole.** When a plan changes a list record or its columns file,
   push builds the list's complete layout from the working tree: the list record and every
   column, in the file's order and positions. It loads that as one List Layout update with
   `POST /api/fluent/load/<scope sys_id>?targetUpdateSetId=<scope's update set>`. The list's and
   each column's sys_ids come from the files, so the list keeps its identity and integrate
   confirms it (ADR-0025, item 5).

2. **snagentic writes the update itself, in the form the ServiceNow SDK builds.** The SDK's
   `List()` builds exactly this record (`list-plugin`, SDK 4.13.6). It derives sys_ids itself and
   pins them only through a generated key registry (`keys.ts`, the SDK's internal format). A list
   has no compiled parts, unlike a flow (ADR-0028). So snagentic writes the composite record from
   the files with a pure function, and a contract test builds the same list with the embedded SDK
   and compares the two. An SDK upgrade that changes the format fails that test.

3. **A removed column is removed.** The platform replaces a list's columns with the update's, so
   push can remove a column, which ADR-0025 refused. Every other child-row removal is still
   refused.

4. **The plan shows a list as one change** with its columns in order, not as rows. The plan id
   covers the list's content. Before loading, push checks that the instance's list and columns
   have not changed since the pull (`sys_mod_count` and `sys_updated_on`, as for rows), and stops
   if they have.

5. **Capture is checked under the list's update name** (`sys_ui_list_<table>_<view>`, plus the
   domain when it is not global), read from the list after the load. When the platform put the
   update in the application's Default set, it is moved as for records (spec 006, B5).

6. **Out of scope until tested live:**
   - related list layouts (a list with `parent` or `relationship`);
   - personal lists (`sys_user` set);
   - a change to the list's identity fields (table, view, domain).

   The plan refuses these with a reason. Push never falls back to writing rows through the Table
   API.

## Consequences

- List layouts travel with the batch, and a column can be removed from git.
- Lists depend on `fluent/load`, which is not in the public REST reference. ADR-0028's live
  contract test already covers that endpoint.
- A list load rewrites every column of the list. The instance raises each row's
  `sys_mod_count`, so the next pull shows the list as changed, with the same content.
- Form layouts (`sys_ui_section`, `sys_ui_element`) and related lists
  (`sys_ui_related_list_entry`) still go through the Table API. Whether the platform records
  them is to be tested the same way.

## Alternatives considered

- **Build a generated Fluent project with the embedded SDK** (S14's route). It works, but it
  writes the SDK's internal key registry to pin sys_ids, takes seconds per build, and adds a
  build to every push that touches a list. The contract test keeps snagentic's output equal to
  the SDK's without those costs.
- **Keep the Table API and add the update record afterwards.** That means writing
  `sys_update_xml` payloads by hand, which is the platform's own job. Rejected.
- **Leave lists to the instance.** Rejected: a feature's lists are part of the feature, and
  ADR-0025 made them deliverable.
