# 0018. Update sets are read live, and exported from reads

- Status: Accepted
- Date: 2026-10-06
- Requirements: ASR-16; plan section 5.1 (M5)
- Relates to: 0012 (production read-only), 0013 (v1.0 scope)

## Context

v1.0 needs `update-sets list / show / collisions / export`. v1 copied open and recent update
sets and their entries to disk. ServiceNow's own "Export to XML" is a UI action that creates a
temporary remote update set, unloads it and deletes it: a write, behind a browser session.

## Decision

1. **Live reads, nothing mirrored.** Each command reads the instance when run: open sets and
   those changed in the last *N* days, entry counts by one grouped aggregate, entries without
   payloads except for export. Update sets change by the minute while people work, a disk
   copy would be stale, and these reads work on test and production instances (read-only by
   construction, ADR-0012).
2. **Export is built from reads.** snagentic reads the update set, its updates (whole records,
   with payloads) and the field definitions of `sys_remote_update_set` and `sys_update_xml`
   from the instance's dictionary, and renders ServiceNow's unload format itself. Nothing is
   created on the instance, and the file follows the instance's release.
3. **Copies get ids derived from the originals** (sha256 of the source sys_id), so exporting
   twice gives the same file and importing it twice updates rather than duplicates.
   `sys_recorded_at` is kept: it orders updates when the set is applied.
4. **`collisions` is a finding**: it exits with 1 when records are held by more than one open
   update set, so CI can stop on it. Default update sets are counted apart.
5. MCP exposure (one `update_sets` tool) comes with M7.

## Evidence (PDI, 2026-10-06)

- The renderer reproduces an "Export to XML" file published by ServiceNow byte for byte
  (26,740 bytes, 9 records, 184 fields; the file is not committed). Rules confirmed: fields in
  alphabetical order; references carry `display_value`; empty fields self-closing; values with
  markup in CDATA unless they contain `]]>`, which are escaped instead.
- An export of a completed PDI update set was imported back with "Import Update Set from XML":
  ServiceNow loaded it as a remote update set in state `loaded`, with the derived ids, the
  original `remote_sys_id`, and the update's `payload_hash` and `sys_recorded_at` unchanged.
  The import was deleted afterwards.
- Live reads on the PDI: `list` (16 sets), `show` (18 updates), `collisions` (20 records in
  6 open sets), each a handful of requests.

## Consequences

- No update-set history in the workspace: an agent asks the instance, which is always current.
- A very large update set is held in memory to render; streaming the export can come later.
