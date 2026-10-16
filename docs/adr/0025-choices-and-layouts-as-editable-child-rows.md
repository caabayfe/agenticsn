# 0025. Choice lists, form and list layouts, and applications are delivered from files

- Status: Superseded by 0031 (2026-10-16) for authoring: choices, layouts and applications are Fluent source; the mirror's child rows are read-only
- Date: 2026-10-13
- Requirements: ASR-01, ASR-02, ASR-05, ASR-16
- Amends: 0017 (flat record layout and full sync), spec 004 (plan and push)
- Relates to: 0007 (disk format), 0011 (enforcement layers), 0016 (instance load)

## Context

A feature of any size adds a table, and a table needs choice lists (states, decisions) and a
form and a list a person can use. Today snagentic delivers neither:

- `sys_choice` is not `sys_metadata`, so pull never mirrors it, and push refuses to create
  choices because the next plan would create them again.
- Form and list layouts are child rows (`sys_ui_element` of a `sys_ui_section`,
  `sys_ui_list_element` of a `sys_ui_list`, `sys_ui_form_section` of a `sys_ui_form`,
  `sys_ui_related_list_entry` of a `sys_ui_related_list`). Child-row files are read-only: an
  agent may not edit them, and a plan that changes one is blocked.

So a new table pushed by snagentic has no choices and a bare form, and the developer finishes
it by hand on the instance. Preparing a two-week build (User Access Review) as a stress test
showed these two gaps block a best-practice data model before anything else.

## Decision

1. **Choices are mirrored as child rows of their table.** `sys_choice` rows are attached to the
   `sys_db_object` record of the table their `name` field names, in
   `<table record>.children.sys_choice.yaml`, sorted by sys_id like every child file. Rows are
   matched to tables by name through one listing of `sys_db_object` (`sys_id`, `name`) per pull
   that reads choices. A choice whose `name` is not a table is an orphan, counted as today.
   An incremental pull reads choices through the change feed and per-table counts like the
   other child tables (ADR-0016). A child table with no fingerprint yet is listed whole, so an
   existing workspace gets its choices on the next pull.

2. **Five child tables are editable:** `sys_choice`, `sys_ui_element`, `sys_ui_list_element`,
   `sys_ui_form_section` and `sys_ui_related_list_entry`. Flow, workflow and variable-value
   child rows stay read-only: their records are compiled by the platform (snapshots, versions),
   and writing their rows through the Table API would leave flows the designer cannot open.

3. **Push writes child rows one row at a time, compared by sys_id** against the file as last
   pulled:
   - a new row (new 32-character sys_id) is created, with the owner's scope;
   - a changed row is updated with the fields that changed. Push first reads the row and stops
     if its `sys_mod_count` or `sys_updated_on` moved since the pull, as it does for records;
   - a removed row is refused, as deletes are (spec 004, D2). The hint names the way out:
     set `inactive` on a choice; remove a form or list field on the instance;
   - a row's parent field must name its owner: the section, list or form whose file it is in,
     or for a choice the table whose file it is in.

   Child rows are written after their owner: rank 7 for layouts, after records (6); choices
   keep rank 2, after the table and its fields.

4. **Capture is checked under the name the platform records.** The update set records a form
   section's fields as the section, a list's elements as the list, and a table's choices as
   `sys_choice_<table>_<element>`. Records are not always `<table>_<sys_id>` either (a list is
   `sys_ui_list_<table>_<view>`). Push now reads the record's, or the owner's, `sys_update_name`
   after writing, and checks the update set for that name.

5. **Integrate takes the instance's child file** when every row in the local file comes back
   with the same sys_id and every local field unchanged, as `instanceConfirms` does for
   records. A record created here, renamed by the platform and pulled back moves together with
   its child files only when those are confirmed too; otherwise both stay for the user.

6. **The agent may edit the five editable child files.** The protected-paths guard (ADR-0011,
   layer 1) keeps refusing every other child file. The workspace instructions and the build
   skill say how to write a row.

7. **Scoped applications are created from files** (amended 2026-10-13, at the product owner's
   request: best practice puts a new feature in a scoped application, and leaving its creation
   to Studio left a manual step at the start of every build).
   - `sys_app` (custom application) is not `sys_metadata`, so no change feed sees it. Every
     full pull lists it whole, in one listing: an instance has a handful of custom
     applications. An incremental pull lists it again when the `sys_scope` fingerprint the
     operational inventory already reads has moved (an application is a `sys_scope` row), so
     a pull with no changes asks nothing more (ADR-0016).
     Each is written as a record of its own scope, `<scope>/sys_app/<name>--<sys_id>.yaml`;
     the file of an application that was renamed or deleted on the instance is removed.
   - An agent creates an application by adding that file: the application's sys_id is the
     scope's sys_id, and its `scope` starts with the instance's vendor prefix
     (`x_<company code>_`). The property `glide.appcreator.company.code` is allow-listed by
     default so the mirror shows the prefix; it is not a secret.
   - Push writes the application first, before any other record of its scope. It opens the
     scope's update set with the application's sys_id before the application exists, and makes
     it the current update set for that scope, so the application record itself is captured
     in the batch with the rest of the scope's records.
   - The Table API ignores the `sys_scope` an insert is sent: the platform creates the record in
     the user's current application. Found live on pdi2, where a first push created the
     application's tables in global (renamed `u_x_...`). Push therefore makes each scope's
     application current (`apps.current_app`) while it writes that scope, as it does the
     update set, and restores both preferences afterwards. This holds for every create in a
     scope, not only for new applications.
   - Only creating an application is in scope. Editing an existing application's record
     (version, vendor) through push works like any record, but deleting one is refused as all
     deletes are.

## Consequences

- A table built by an agent can ship complete: fields, choices, form, list and related lists.
- A feature can start from nothing: the application, then its records, in one batch.
- Reading applications adds no request to an incremental pull with no changes; when a scope
  changed, it adds one listing of `sys_app`.
- Pull mirrors more rows: choices are typically tens of thousands on a PDI. One extra listing
  of `sys_db_object` (two fields) is read per pull that touches choices.
- Layout edits that remove a field still need the instance. Choices are retired with
  `inactive`, which is the platform's own practice for choices already used by records.
- Capture checks read one more row per write (`sys_update_name`).
- The update-set names for child rows are confirmed live on a PDI before release; a wrong
  name shows as `notCaptured`, never as a lost write.
