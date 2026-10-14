# Spikes S-A and S-B: installing an accelerator pack (spec 005)

Run on pdi2 (Australia patch 7, company code 2222332) on 2026-10-14, as admin, with `s-a.ts` and
`s-b.ts`. Scratch left on pdi2: the application `x_nttdata_s005a` (inactive), 20 `cmn_location`
records "snagentic test S-B location 01–20", import sets ISET0010001 and ISET0010002.

## S-A: a fixed vendor prefix

Question: can the Table API create `x_nttdata_acc` on an instance whose company code is not
`nttdata`? Decides ADR-0026's open item: one fixed scope, or a scope parameter per instance.

- **Yes.** `POST /api/now/table/sys_app` with scope `x_nttdata_s005a` answered 201; `sys_scope`
  holds `x_nttdata_s005a` as given (the instance's prefix is 2222332). Push's existing path for a
  new application (ADR-0025) creates the pack's application as written.
- **Not tested: moving the update set to a second instance** (retrieve, preview, commit). It needs
  a second PDI; it is the same question as flows test B2, and both run together.
- Recommendation: a fixed scope, `x_nttdata_acc`, amended into ADR-0026 once the move is proven.

## S-B: the Import Set API for `accelerator load`

Through `imp_location` (transform map "Location", coalescing on name and the address fields):

| Question | Answer on pdi2 |
|---|---|
| Is the transform synchronous? | **Single row (`POST /api/now/import/<table>`): yes.** The answer carries the import set, and per transform map the target table, sys_id and status. About 340 ms a row (20 rows: 6.8 s). |
| `insertMultiple`? | **Asynchronous.** It answers at once with `import_set_id` and `multi_import_set_id`; the set's mode is `asynchronous`, its rows stay `pending` (still pending after 18 s): nothing transforms them without the scheduled transformer. Not usable for a load that reports per row. |
| What does each row report? | `status` inserted, updated or ignored (with `status_message`, e.g. "No field values changed"), and the target `sys_id`. |
| Coalescing on re-run | The same row again: `ignored`, same sys_id. Same keys, a non-key field changed: `updated`, same sys_id. 20 rows stay 20. An empty source value does not overwrite (copy empty fields off). |
| Roles | Run as admin; the minimum role (`import_set_loader`, `import_transformer`) is not tested yet. |

Consequences for the load adapter (plan M6):
- one request per row, through the request scheduler, never retried (a re-run is safe because the
  transform coalesces, but ADR-0016 forbids retrying writes);
- report per row from the answer (inserted, updated, ignored, error), counts and business keys
  only, never field values;
- budget: about 3 rows a second on a PDI; the 9 entities of the demo data set (hundreds of rows)
  take minutes, so `load` reports progress and honors cancellation;
- every entity's import set table needs coalesce fields matching its `key` in the manifest, or a
  re-run duplicates records.
