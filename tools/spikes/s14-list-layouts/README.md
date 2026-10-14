# Spike S14: how list layouts are recorded in update sets (spec 006, B9)

Question: push wrote the Access Review application's list layouts (`sys_ui_list` with
`sys_ui_list_element` rows) and related lists (`sys_ui_related_list`), and no update set
recorded them. Is that the way push writes, or the platform?

Run on pdi2, 2026-10-14, as admin in the global domain, the way push writes: the application
current (`apps.current_app`), a probe update set in the application current
(`updateSetForScope<app>` and `sys_update_set`).

| Write through the Table API | Recorded in the probe update set |
|---|---|
| A list element's position 7 → 8 → 7 | nothing |
| The list's `sys_name` changed and put back | nothing |
| Control: an inactive UI action's `hint` changed and put back | `INSERT_OR_UPDATE UI Action sys_ui_action_<id>` |

- `read.ts`: no `sys_update_xml` exists under `sys_ui_list_x_2222332_acc_rev…` or
  `sys_ui_related_x_2222332_acc_rev…`, in any update set.
- `sample.ts`: pdi2 has no list layout update at all (`sys_ui_list_…`) to use as a template.
- The lists' `sys_update_name` embeds the domain they were created in
  (`sys_ui_list_<table>_null_<domain sys_id>`), even after the record moved to global.

## Finding

The platform does not record list layouts or related lists written through the Table API. The
same session, preferences and update set record other classes. List layouts are recorded only
when the UI saves them ("Configure list layout"), which writes one "List Layout" update for the
list and all its elements.

## Option A: the ServiceNow SDK's list, loaded into the batch set

The SDK (4.13.6, the build spike S13 embeds) defines `List({ table, view, columns })`. Its build
(`list-plugin.ts`) writes the platform's composite list layout: one `record_update` holding the
list and its columns, named `sys_ui_list_<table>_<view or null>[_<domain>]`. `load.ts` posts the
built XML to `/api/fluent/load/<scope>?targetUpdateSetId=<set>` (spike S11's route, ADR-0028),
in a configuration project of the Access Review application (`proj/`, `pin/` in the scratchpad;
`now.config.json` with `scope`, `scopeId`, `type: configuration` only).

| Load | Result |
|---|---|
| Item list, `view: 'Default view'` (a string) | A new list for a view id the SDK made up (`13a5…`): the Default view's sys_id on the instance is literally `Default view`. Recorded as a List Layout update. Wrong input: use the SDK's `default_view`. |
| Item list, `view: default_view`, ids not pinned | The platform matched table, view and domain, **replaced** the existing list (`d329…`) with the SDK's ids (`200b…`), same columns. Recorded as List Layout `sys_ui_list_x_2222332_acc_rev_review_item_null` in the probe set. |
| Campaign list, ids pinned through `keys.ts` from the mirror, no change | The built XML carries the mirror's sys_ids; the list keeps `b0ce…` (recreated, same id). **Nothing recorded**: no change, no update. |
| Same, two columns swapped | Recorded as List Layout `sys_ui_list_x_2222332_acc_rev_campaign_null` in the probe set; id kept; new order applied. |
| Same, original order loaded back | Order restored; the set still holds one update for the list (replaced in place). |

Every load left the user's preferences (`apps.current_app`, `sys_update_set`,
`updateSetForScope<app>`) as they were: no switching, no restore.

### Conclusions

1. **The route records list layouts.** A changed list loaded through `fluent/load` into a named
   set is recorded there as the platform's own List Layout update. snagentic never writes the
   update's format: the SDK builds it and the platform records it.
2. **Identity is kept by seeding `keys.ts` from the mirror.** The SDK derives a list's sys_id
   from table, view and domain unless the key registry names one. Push writes the registry from
   the mirror (the list's and each column's sys_id); without it the platform replaces the list
   under new ids, and the next pull sees a delete and a create.
3. **Only changed lists should be loaded.** An unchanged list is recreated (same ids) and not
   recorded, which is right, but it is a needless write.
4. **Use `default_view` for the Default view.** A view given by name is hashed into an id that
   does not exist on the instance.
5. **Related lists are not covered by a dedicated SDK plugin.** `sys_ui_related_list` would go
   through the SDK's generic `Record()`; whether the platform records that is not tested yet.
6. Not tested: a list in a domain other than global (update name suffix), a list of a global
   table, moving the batch to a second instance.

## Leftovers on pdi2

- Update set "S14 list layout probe" (Access Review application), state **ignore** so it is never
  promoted: the S12 probe UI action's update and three List Layout updates.
- The stray list from the first load (`bb00…`, a view id that does not exist) and its nine
  columns were deleted (`cleanup.ts`, approved by the user).
- The item list's sys_id changed from `d329…` to `200b…` (same columns): the next pull shows it.
