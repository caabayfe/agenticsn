# 007. Everything push writes travels with the update set: plan

- Status: Draft, executed autonomously on 2026-10-15 at the product owner's request ("assess what
  other mechanisms need to be moved to the Fluent SDK … everything migrated with full end to end
  testing"); for the owner's review with ADR-0030
- Date: 2026-10-15
- Builds on: ADR-0029 (list layouts), ADR-0028 (the `fluent/load` route), ADR-0025 (layouts and
  choices from files), ADR-0027 (domains)
- Evidence: spike S15, `tools/spikes/s15-composite-loads/README.md` (pdi2)

## 1. Goal

Every record push writes reaches the batch's update set, so the batch moves the whole feature. A
write the platform does not record is delivered the way the platform records it, through the
Fluent load route. Records the platform records already keep the Table API.

## 2. Assessment: what the platform does not record

A table is recorded in update sets when its collection dictionary entry says so. That attribute,
read for every one of the 1,503 classes in pdi2's mirror, sorts them:

| Attribute | What a Table API write does | Classes that matter for push |
|---|---|---|
| `update_synch=true` (~1,450 classes) | Recorded under `<class>_<sys_id>` | Everything push writes today, except below |
| `update_synch_custom=true` | **Never recorded.** Only the platform's layout editors record one composite update | Lists `sys_ui_list` (5,070 in the mirror), form sections `sys_ui_section` (7,117), related lists `sys_ui_related_list` (1,692), with their child rows |
| `update_synch=false` | **Never recorded** | Scheduled jobs `sysauto_script` (531); rarer: `sys_portal_page`, `cmn_schedule`, `sys_embedded_help_content`, `sys_scope_table_access`, `sysauto_query_builder` |
| (flow internals, `var_dictionary`) | not recorded | Already delivered by Fluent flows (ADR-0028) |

Two cross-checks on pdi2:

- **Census of the Access Review application**, which push built: every update name of its 210
  mirrored files looked up in `sys_update_xml`. Not recorded: its lists (but S14's), its 3 form
  sections, its 2 related lists, and its scheduled job. Everything else was recorded.
- **A capture matrix pushed with 1.8.0** to the scratch table: a script include and a form were
  recorded; a scheduled job and a related list were reported "NOT captured". A form section and its
  fields were reported **captured but were not**. The capture check looked for the form's update,
  not the section's (bug, fixed in M1).

## 3. Spike S15: what the Fluent load route records

Loaded with `fluent/load` into the batch's scoped set, on the matrix's records:

| Load | Instance | Recorded |
|---|---|---|
| Form section, composite (section and elements) | Order applied; sys_ids kept | "Form Layout", `sys_ui_section_<id>` |
| Scheduled job, one record | Script applied; sys_id kept | "Scheduled Script Execution" |
| Related list, composite | Content applied; **list and entries recreated with new sys_ids** | "Related Lists", `sys_ui_related_<table>_<view>` |
| Related list, one record per row (the SDK's generic form) | Creates work; **an entry cannot be updated** ("invalid scope": entries have no scope) | "Related List", "Related List Entry" |

The platform's related-list handler always recreates the list (the list editor does the same), so
a related list's identity is its table, view and domain, not its sys_id.

## 4. Decisions (ADR-0030)

1. **Push picks each write's route from the instance's own attribute**, read at plan time for the
   planned classes and their parents: recorded classes keep the Table API; the rest are loaded.
2. **The format is the ServiceNow SDK's where it has one**, guarded by a contract test that builds
   the same record with the embedded SDK: `List()` (lists), `Form()`'s section writer (form
   sections), `Record()` (one record of a non-recorded class). Related lists have no SDK plugin, and
   the SDK's per-row form cannot update an entry, so they use the platform's own "Related Lists"
   format, checked against the update the platform recorded in S15.
3. **Composite records are delivered whole** (section with its elements, related list with its
   entries), like lists: a removed row is removed.
4. **A related list comes back under new sys_ids.** Integrate pairs it with the local file by
   table, view and domain, and takes the instance's copy when its entries match by content.
5. **The plan shows the route.** A loaded change is marked `loaded`, and the capture check looks for
   the update name the load records.

## 5. Milestones

| | What | Proof |
|---|---|---|
| M1 | Capture check: a form section's update is `sys_ui_section_<id>`, never the form's | Unit test; the matrix reports the truth |
| M2 | Composite delivery generalized from lists; form sections delivered whole | Unit tests; SDK contract test; live |
| M3 | Route by `update_synch`; records of non-recorded classes loaded as one record | Unit tests; SDK `Record()` contract test; live (scheduled job) |
| M4 | Related lists delivered whole; integrate pairs them by table, view and domain | Unit tests; live, including a second edit after a pull |
| M5 | End-to-end matrix on pdi2 (section 6) | Every write captured; pull and integrate clean; nothing left to push |
| M6 | ADR-0030, docs, agent instructions, changelog | `bun run verify` |

## 6. End-to-end matrix (pdi2, scratch table `x_2222332_s11_list_probe`)

A feature pushed from git with a release candidate, then edited and pushed again:

1. Create: a script include, a business rule, a choice, a form (Table API); a form section with
   fields, a list, a related list (composite); a scheduled job (one record). All in one push.
2. Edit: reorder and remove a field of the section, reorder the list, add and remove a related
   list entry, change the job's script. One push.
3. A Default-domain list and section (ADR-0027).
4. After every push: `notCaptured` is 0, the batch holds one update per changed record, pull and
   integrate leave the branch clean, and the next plan has nothing to push.

## 7. Out of scope

- Moving the batch to a second instance (spec 004 promotion; needs a second PDI).
- Rare non-recorded classes beyond a scheduled job: they take the same route, but only the job is
  tested live.
- Rewriting the YAML mirror in Fluent: records the platform already records gain nothing from it.
