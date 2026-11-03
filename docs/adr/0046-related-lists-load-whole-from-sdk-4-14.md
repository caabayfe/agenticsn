# 0046. Related lists load whole from SDK 4.14; modules add to shipped ones entry by entry

- Status: Accepted (product owner, 2026-11-03)
- Date: 2026-11-03
- Requirements: G1, ASR-01, ASR-15
- Amends: 0033 (item 1, units; item 5, removed definitions)
- Relates to: 0042 (ensure rules, item 3), 0030 (item 8, findings on related lists), 0031
- Evidence: SDK 4.14.0 `sdk-build-plugins/dist/related-list-plugin.js`; the ITSM pack built with
  4.13.6 and 4.14.0 (2026-11-03); a load spike on pdi3 (below)

## Context

SDK 4.13.6 wrote a related list (`sys_ui_related_list`) and each of its entries
(`sys_ui_related_list_entry`) as separate updates. Loaded one by one, an entry was added to the
layout and nothing else changed.

SDK 4.14.0 adds a `RelatedListPlugin`. A `sys_ui_related_list` record in the app is written as
one file, `sys_ui_related_<table>_<view>.xml` (plus `_<domain>` outside global), holding the list
and every entry of the app that points at it. The plugin's own note: "the platform installs a
related list as one payload that replaces the whole list, entries included". An entry whose list
is not in the app is still written on its own, with a build warning.

snagentic 2.15 cannot read the composite file (`unreadable-build: no record names the unit`), so
main cannot plan the ITSM pack since the SDK upgrade (#190).

A spike on pdi3 confirmed the replacement. A list with two entries, loaded as separate records,
then a composite of the list and one new entry: the two entries were deleted. The update set
recorded one "Related Lists" update under the composite's name. The list and the entry kept the
sys_ids the file carried; the list was created again (`sys_mod_count` 0, a new `sys_created_on`).

snagentic's ensure rules restated each shipped container as a `Record()`, to take it over. ADR-0042
item 3 already said the container is never restated. With 4.14 the restatement turns every ensure
fact into a replacement of the whole layout: the next ITSM install would remove the platform's 8
related lists from the incident form, and the 16 of Service Operations Workspace's incident view.

## Decision

1. **A composite related list is one unit**, named as the SDK and the platform name it. Its head
   is the list, found by sys_id or by table, view and domain. Its rows are the entries, matched by
   related list and compared in position order, like a list layout's columns (ADR-0029). The plan
   shows an instance entry the build leaves out as a change: the load removes it.

2. **A list declared in a module's source is owned whole.** That is the SDK's semantics and the
   platform's. A module that adds to a layout it does not own uses an ensure rule.

3. **Ensure rules never restate the container** (ADR-0042 item 3, now enforced). The generated
   entries name the container by sys_id, so the SDK writes each one on its own and the load only
   adds it. The container is no longer taken over. Generated container files from earlier
   installs are removed by the next install.

4. **Ledger entries the SDK renamed are not removed definitions.** A ledger entry the build no
   longer names is forgotten, with no question to the instance, when:
   - a built unit carries its record (the same table and sys_id, as head or row): the old
     `sys_ui_related_list_<id>` and `sys_ui_related_list_entry_<id>` of a list now built whole;
   - it is a related list that built entries still point at: a container ensure stopped
     restating. Deleting it would orphan them.

## Consequences

- **Easier:** snagentic builds with the SDK's current format, and a list a module owns is exact
  on every instance, entries removed included.
- **Harder:** a pack that restated a shipped container in its source now replaces the layout. The
  ITSM pack does this for Service Operations Workspace's incident view (incident-relations): it
  must move that entry to an entry by sys_id before it installs with this snagentic.
- **To do:** pack lint warns on a `sys_ui_related_list` record in module source; a container's
  customization by a client is no longer detected (it was the take-over's only use).

## Alternatives considered

- **Split the composite back into separate records before loading.** Keeps 4.13's behavior and
  every ledger name, but loads a format the SDK no longer writes, and a module could never remove
  an entry from a list it owns.
- **Restate every instance entry in the ensure container.** Keeps the composite, but writes the
  platform's and the client's entries into the module's update set, and replaces them on every
  instance the set is promoted to.
- **Hold SDK 4.14.** Postpones the work; the next SDK keeps the plugin.
