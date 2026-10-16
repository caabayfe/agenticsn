# Spike S16: Fluent as the only authoring format (spec 008, F1–F4)

pdi2 (Australia), SDK 4.13.6 (the embedded one), 2026-10-16. Run from source, with the SDK's
telemetry off (`NO_TELEMETRY=1`). Every credentialed call goes through snagentic's own adapters.
Not product code.

| Script | Does |
|---|---|
| `scaffold.ts` | An empty `configuration` project for a scope, linked to the SDK in this repository |
| `mirror-xml.ts` | A scope's mirrored records as update XML, rendered with the product's own writers |
| `compare.ts` | A build's records against the mirror, field by field. Child records the platform matches by content (dictionary entries, choices, form elements, labels) are matched by that key |
| `sdk.ts` | `now-sdk` against the instance, with the credential passed only to the child process |
| `live.ts` | Update sets, `fluent/load`, update entries and reads, through snagentic's client |

## F1: converting existing records to Fluent

The Access Review application: 143 mirrored records, 233 with child rows. Each route converts with
`transform`, builds, then compares the build with the mirror.

| Route | Result |
|---|---|
| **A.** Mirror → our update XML → offline `transform --from` | 141 records identical by sys_id. **Broken:** the mirror keeps raw reference values without the display and key attributes the platform's XML carries. So `Table.extends` came out as the parent's sys_id, which builds a wrong parent table, and the forms were given new keys and sys_ids |
| **B.** `now-sdk download` (the platform's own XML, one read) → `transform` | Every authored field survives, except the SDK losses below. Dictionary entries, choices and form elements get new sys_ids; the platform matches them by name, so this is harmless. `Form()` re-expresses a section as columns (`.begin_split`, renumbered positions): the same layout |

**SDK losses**, in both routes:

- Default-domain choices lose their domain (14). Choices that override another domain's value are
  dropped (5).
- Table licensing configs (`ua_table_licensing_config`, 3) are consumed and never written back.
- A `Record()` reference field gets its display value instead of the sys_id
  (`sys_wizard_answer.question` = "Task").
- API defaults replace authored values:
  - notification digest separators (5);
  - a scheduled job's time fields;
  - a baseline business rule's empty `priority` becomes 100.
- Empty UI policy scripts are reformatted. Script includes and business rules are unchanged.

**A mirror bug** shows here too: the three forms' section rows are in the Default domain, and the
full pull doesn't see them (ADR-0030's open bug).

## F2: loading and capture

The S11 test app was converted from the platform's XML, then one change was made per kind of
record. The build's changed files were loaded with `fluent/load` into the scope's update set
(`snagentic: live/list-layouts [x_2222332_s11]`).

| Change | Recorded as | On the instance |
|---|---|---|
| Script include, business rule (description) | Script Include, Business Rule | applied |
| Table column label, new choice | Dictionary, Field Label, Choice list | applied, choice added |
| Scheduled job (script) | Scheduled Script Execution | applied |
| List columns | List Layout | applied, same list |
| Form section (reorder, add a field) | Form Layout | applied, same section |
| **New ACL with a role** | Access Control, Access Roles | created, **with no elevated session** (the Table API needs one, ADR-0024) |
| Property value | System Property | applied |
| **Baseline business rule**, in a `global` project (`transform --table --id`) | Business Rule, in a global set | applied; stays in its plugin package. Side effect: `priority` 100 |

**All 12 changes were recorded under the platform's update names.** Three more facts:

- **Loads don't stamp the record.** `sys_mod_count` and `sys_updated_on` keep their old values,
  so the incremental pull misses the change. This is ADR-0030 item 5 again, now on the SDK's
  output.
- **Builds aren't repeatable for named views.** A list or related list in a named view ("Mobile")
  gets a new random placeholder sys_id on every build. The platform resolves it by name, but the
  plan digest and the changed-files diff need it normalized.
- **An update set created through the Table API lands in the user's current application.** Push
  already handles this.

## F3: domains and deletions

| Test | Result |
|---|---|
| Default-domain list (`List({ domain })`), columns changed | Updated in place: same sys_id, same domain |
| Default-domain section (`Record` with `sys_domain`), a field added | Updated in place, in its domain |
| `Now.del('sys_properties', { name })` | Deleted. Recorded as DELETE under the build's random sys_id, not the record's own |
| A property removed from source, with no `Now.del` | **Stays on the instance.** A `configuration` project never deletes implicitly |

## F4: edits made on the instance

1. A local branch adds a method to a script include and changes a business rule's description.
2. Meanwhile the instance changes the script include's description and the rule's order.
3. On a branch from the base commit, the SDK re-reads both records from the instance
   (`transform --table --id`). It rewrites only the changed properties.
4. `git merge` combines both sides with no conflict.
5. The merged build was loaded, and the instance then held all four changes.

## Left on pdi2

- In the S11 test app:
  - the changes above;
  - a new ACL `x_2222332_s11_e2e` read, with the admin role;
  - the choice "pending";
  - the deleted property `x_2222332_s11.matrix_a_*`, which was a spike leftover.
- Baseline business rule "SNC - ITIL - Close Related", which is inactive: its description was
  restored, but `priority` is now 100 instead of empty. Both loads are in
  `snagentic: S16 F2 [global]`.
- An empty global update set named `snagentic: S16 F2 [x_2222332_s11]`, created in the wrong
  application by the Table API.

## Not tested

- Moving a batch to a second instance.
- Edits from the form designer coming back: whether a `Form()` file refreshes with a small diff.
- A conversion larger than one application.
- Build time on a large project.
