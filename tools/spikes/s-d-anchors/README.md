# Spike S-D: anchors through an import set (spec 011)

Question: can rows a pack owns (anchors) be loaded with a fixed sys_id through an import set,
matched on it when they are loaded again (even renamed), while rows without one (customer data)
match on their business key? Decides ADR-0038 item 7 and the transform every pack entity uses.

Run on pdi2 (2026-10-18) from the workspace `spaces/pdi2-acc`, branch `acc/sd-probe`: a staging
table `u_acc_imp_probe` (`u_name`, `u_city`, `u_sys_id`) and a transform map to `cmn_location`,
written in Fluent with literal `$id`s, delivered by `push`, loaded by `accelerator load --demo`
from a scratch pack. `read.ts` reads what a load did; `remove.ts` removed the probe's records.

| Try | Result |
|---|---|
| Template columns `name`, `city`, `sys_id` posted as they are | The staging columns stay empty: the Import Set API does not map `name` to `u_name`. **`sys_id` becomes the import set row's own sys_id**, so a second load fails on a duplicate row |
| Columns posted as `u_<column>`; field map `u_sys_id` → `sys_id`, coalesce, with a source script returning the row's `u_sys_id`, else the sys_id of the target with the same name | Customer rows (no sys_id) match by name: the second load is "unchanged". **Anchors don't keep their id**: the platform gives the new record a random sys_id, so every load inserts another |
| As above, plus the map script `if (!isUpdate && source.u_sys_id) target.setNewGuidValue(source.u_sys_id)` | **Passes.** The anchor is created with its fixed sys_id; a second load changes nothing; renaming it in the template updates the same record; the customer row still matches by name |

Also found:

- The SDK's `ImportSet()` writes transform maps **inactive**, with business rules off, and gives its
  field maps build-chosen sys_ids (composite keys). A pack writes maps and field maps as `Record()`
  with literal `$id`s instead, so every install creates the same records without a `keys.ts`.
- A literal 32-character `$id` is used as the record's sys_id; the build still lists it in
  `keys.ts`, under its own value, so the entry is the same in every workspace.
- A new table's collection dictionary row comes back with
  `attributes=enforce_dot_walk_cross_scope_access=true`, which the build never sends: push called
  it "not applied as built", kept it out of the ledger, and the next plan refused it as "never
  adopted". Fixed: the comparison accepts that platform attribute (`sameAttributes`).

**Decision for packs:** every entity's staging table is `u_acc_imp_<entity>` with `u_` columns;
its transform coalesces on `sys_id` through the source script above and creates anchors with
`setNewGuidValue`. `accelerator load` posts template column `x` as `u_x` to a `u_` table, and
always posts `sys_id` as `u_sys_id`.

Left on pdi2: the probe table and transform map (scratch, global, update set "acc-sd probe").
