# 009. Building a whole feature in Fluent: analysis

- Status: Draft. Offline analysis done; live spike S19 not run
- Date: 2026-10-17
- Asked by: the product owner (2026-10-17): "understand better what the fluent sdk gives us, what
  are we losing, and what is the best way to have inbound email actions, modules and roles, UI
  actions, dictionary entries, choices, script includes, ACLs, flows and UI policies … the BEST
  way to have a capability that allows for a complete build of a servicenow feature"
- Builds on: ADR-0031 (Fluent only), ADR-0032 (the SDK's connector), ADR-0033 (units, ledger)
- Evidence, all offline:
  - the embedded SDK 4.13.6, still the latest on npm (`sdk-build-plugins/dist/*-plugin.js`,
    `sdk-core/src`, `sdk-build-core/dist/plugins/override.js`, the bundled guides);
  - offline builds and `transform --from` of platform XML made from mirror records, run through
    snagentic's own `SdkToolchain`;
  - column lists and counts from the pdi2 mirror (490k records);
  - snagentic's `authoring/` domain (`unit-specs.ts`, `compare.ts`, `losses.ts`, `values.ts`).

**C** means confirmed by code, build or count; **S** means suspected, to be settled by S19.

## 1. Criteria

"Best" is scored on the same criteria for every class, in this order of weight:

1. **Fidelity:** adopt then build gives back the instance's record (no silent change).
2. **Capture:** the load is recorded in the batch's update set, children and deletes included.
3. **Completeness:** every column a design needs can be authored.
4. **Checkability:** the gate can see and rule on it (scripts, security, scope).
5. **Explicit deletion:** what source removes, the instance loses, and the plan says so.
6. **Baseline safety:** changing an out-of-box record touches only what was meant.
7. **Readability:** an agent can write it and a reviewer can read it.
8. **Reach:** global, scoped and domain-separated instances.

## 2. Summary

**The SDK can express a complete feature in all ten classes**, but no single route serves every
class. The route is per class. Writes are the platform's own (`fluent/load`). What the SDK gives:

- a typed API for 8 of the 10 (no typed API for modules, nor for declarative actions);
- `Record()` for any table, which writes only the fields named;
- `Now.include` script files, so script rules run on real files;
- `Now.del` deletions, and `keys.ts` for stable sys_ids.

**What we lose is concentrated in nine cross-cutting issues (section 3), not in the classes.**
Fixing them once, in snagentic, fixes most classes. Three of them are product bugs today:

- **B1** a change to `protectionPolicy` or `useEsLatest` alone is never delivered: `sys_policy` is
  ignored by the comparison (`compare.ts:23`), so plan records the ledger and loads nothing (C);
  *fixed after 2.1.0: `sys_policy` compared, the ES-latest row a partial child*;
- **B2** removing a role, view or action from a typed array deletes nothing on the instance: the
  child row is its own unit and survives, so the instance grants more than source says (C, build);
  *after 2.1.0 plan's refusal names the `Now.del` to add; emitting it is decision 2*;
- **B3** a role or view named in source compares as a placeholder sys_id against the real one, a
  permanent unexplained difference (`values.ts:7` covers only `view` and `super_class`) (C);
  *fixed after 2.1.0: named per table, by sys_id when the build knew it*.

**Adopt cannot bring in most existing UI policies today:** 4,776 of 5,350 policy actions on pdi2
have `field_message_type: ''`, which transforms to a value the SDK's own type rejects, so 75% of
policies fail to build after transform (C, offline). Five other classes have smaller defects of the
same kind (section 3, X4).

**Recommended capability:** a per-class **authoring contract**, held in one registry next to
`unit-specs.ts`, that names for each class the route, the adopt normalizations, the named losses,
the named-reference fields, the child units and their deletion, and the gate rules. Section 4 is
the proposed contract; section 6 the decisions it needs.

## 3. Cross-cutting findings

**X1. Children are separate units (C).** UI action roles and views, UI policy actions, ACL roles,
role containment and modules each have their own update name and built file. The typed APIs model
them as arrays on the parent, but removing an entry emits no DELETE (B2). Today plan refuses a
removed child only if the ledger holds it (`plan-units.ts:101`).
→ snagentic derives the removed children itself (ledger plus live child rows) and requires a
`Now.del` or emits it, shown in the plan.

**X2. References by name (C).** Roles and views given by name build with the real sys_id only when
`keys.ts` already knows the name (after adopt); otherwise a random placeholder plus `name=`. Whether
the platform resolves the placeholder on load is S (spikes 1, 5).
→ extend named references to `sys_user_role`, `sys_ui_view` and role containment, resolved by a
live read of the name.

**X3. `$override` adds, it never replaces (C).** Fields the plugin sets ignore `$override` with a
warning: role `suffix`, ACL `advanced`, menu `device_type`, script include `access`, policy
`ui_type`. Transform carries into `$override` only `u_`/`x_` fields and `sys_domain`, so other
unmodelled columns are dropped and left unmanaged: `includes_roles`, `sys_policy`,
`controlled_by_refs`, `sys_overrides`, menu `view_name`, flow `sc_callable`, `acls`.
→ each becomes either a named loss or a `Record()` route for that record; never a silent change.

**X4. Transform defects that block or change adopt (C, offline; per SDK version):**

| Class | Defect | pdi2 records |
|---|---|---|
| UI policy | action `field_message_type: ''` → type error | 2,285 of 3,035 policies |
| Role (global) | `suffix` recomputed as the whole name | 632 of 646 global roles |
| UI policy | `ui_type` dropped when `run_scripts=false` | 176 |
| Script include | `access: ''` → type error | 47 |
| ACL | `advanced=true` with no script → `false` | 56 |
| UI action | workspace flag combination → build error | 6 |
| Inbound action | `action: ''` → `record_action` | 1 |
| Script include | `protected` → empty script, which a push would write | 273 protected |

→ an adapter-level **pre-transform normalization** catalogue tied to the SDK version (like
`losses.ts`), each entry with a fixture and an upstream report. Protected records are refused.

**X5. `Now.del` by keys on tables that don't coalesce (C, build).** A delete by keys of a
dictionary override, ACL role, role containment or choice builds under a new random sys_id. A
delete of `sys_dictionary` by name and element builds correctly
(`sys_dictionary_incident_u_old`). Whether the platform deletes the right row by keys is S
(spike 9); until proven, plan requires deletes of these tables by the real sys_id.

**X6. Baseline records (C, code).** A typed API writes every field the plugin owns (about 45 for
a UI action), so editing an out-of-box record in place customizes all of it. `Record()` writes only
the fields named. Several scoped builds refuse foreign tables (choice sets on `incident`, UI
policies on tables outside an `x_` scope, `OverrideColumn` on baseline tables), and
`Table({augments})` always rewrites the table's label (`table-plugin.js:1236`).
→ a baseline policy: extend by new records in the project's scope where the platform allows it;
edit in place only from `source/global`, with `Record()` for partial edits; copy and deactivate for
UI actions; never `augments`. SN-UPG-002 is implemented from the unit's live `sys_package`.

**X7. Gate blind spots (C, code).**
- Scripts not checked: inbound action `script` and `condition_script`, UI action `condition` and
  `onclick`, SCRIPT-type module `query`, flow step scripts.
- No role rules: elevated privilege, containing `admin`/`security_admin`, `assignable_by`.
- No table policy: `Record()` on grant tables (`sys_user_has_role`, `sys_group_has_role`) builds
  and loads like configuration, though it is data.
- ACLs: unrestricted read and execute ACLs, a new ACL with `admin_overrides=false`, and edits to
  baseline ACLs are not flagged.
- A client-callable script include without its `client_callable_script_include` ACL.

**X8. Flows are not compared (C).** `comparable: false` (`unit-specs.ts:73`): adopt does no field
check, plan decides on ledger hashes only, read-back accepts anything. 229 of 404 flows on pdi2
still have v1 children, which transform turns into raw `Record()` blocks; a round trip of a
published flow dropped `sc_callable`, `callable_by_client_api` and `acls` and emitted an
uncompiled draft snapshot.

**X9. Domains are barely evidenced.** Almost every record in these classes on pdi2 is in global.
One hard limit is confirmed: choices have no domain at the choice level, and transform collapses
domain variants, last row wins (C). ACLs and script includes aren't domain-separated; UI actions,
UI policies, inbound actions and menus carry `sys_domain`, reachable through `$override` (C, build).

## 4. The proposed contract per class

| Class | Route | Adopt | Main losses to name | Gate additions |
|---|---|---|---|---|
| Dictionary (owned tables) | `Table` + typed columns, `$override` for dynamic defaults, reference qualifiers, dependent fields, field roles | yes | `calculation` (exists) | `attributes` dropping keys |
| Dictionary (baseline tables) | `Record(sys_dictionary)`, `Record(sys_dictionary_override)`, `Record(sys_documentation)` | yes (transform yields `Record`) | none seen | refuse `augments`; override coalesce on name+element |
| Choices | inline on owned columns; `ChoiceSet` in global on baseline fields once spike 6 proves it additive | yes, not domain variants | translations (S) | build rows ⊇ instance rows; key adds `dependent_value`; prefer `inactive` to delete |
| Script include | `ScriptInclude` + `Now.include` | yes, not protected | `access ''` | compare `sys_policy`; ES-latest row as child; client-callable needs its ACL |
| Inbound email action | `InboundEmailAction`, `$override` for `sys_domain` | yes | `action ''` | script rules on `script`, `condition_script` |
| Flow, subflow, action | `Flow`/`Subflow`/`Action` for new work | v2-only, unprotected | `sc_callable`, `acls`, … | compare header fields; script rules on steps |
| UI action | `UiAction`; `Record()` for declarative actions | yes | empty `order`, `messages` blank lines | X1 deletes; script rules on `condition`; copy over edit for baseline |
| UI policy | `UiPolicy`; `source/global` for foreign tables | after X4 fix | `ui_type`, action `visible`, `table` | X1 for actions |
| Module | `Record(sys_app_module)` (no typed API) | yes | none seen | script rules on SCRIPT `query` |
| Menu | `ApplicationMenu` for browser; `Record()` for mobile | browser only | `device_type`, `view_name` | never edit a baseline menu |
| Role | `Role()`; `Record()` for global baseline roles | after suffix decision | `includes_roles` | elevated, privileged containment, grant tables blocked |
| ACL | `Acl()`, `$override` for `sys_policy`, `controlled_by_refs` | yes; `Record()` when `advanced` and script disagree | `advanced` | X1 for roles; unrestricted read/execute; baseline ACL edits |

A **feature** is then one or more `configuration` projects whose units are these records. Two
platform facts shape the order of a feature's delivery:

- references between records in one project resolve through `keys.ts` (C);
- the ACL, role and grant behaviour of a load as a user without `security_admin` is unproven
  outside S16's scoped case (spike 3).

## 5. Live spike S19 (pdi2, needs the owner's go)

One scratch scope, one global batch, rolled back at the end. Highest risk first:

| # | Question | Pass criterion |
|---|---|---|
| 1 | New `UiAction` and `Acl` with `roles: ['itil']`, no `keys.ts` entry | role rows hold itil's real sys_id |
| 2 | Remove a role from `roles[]`, plan and push | plan names the deletion; the row is gone |
| 3 | New global ACL on `incident` as admin without `security_admin` | created and captured, or a failed load, never partial |
| 4 | Change only `protectionPolicy` (after B1 fix) | plan loads it; the platform keeps the script |
| 5 | Global `Record(sys_dictionary)` adding `u_x` to `incident` | column and label created; table label unchanged |
| 6 | `ChoiceSet` on `incident.category` with one new choice | every baseline choice remains |
| 7 | Adopt a UI policy with empty `field_message_type` (after X4) | adopt passes; load changes nothing |
| 8 | Adopt a global baseline role, load unchanged | `suffix` stays as it was, or the change is harmless |
| 9 | `Now.del` by keys of an override, ACL role, choice | the right row is deleted and recorded |
| 10 | Adopt and push a published v2 flow unchanged | still published, snapshot clean, a test record runs it |
| 11 | Scoped `Record()` module in the baseline Incident menu | in the navigator, captured in the scoped set |
| 12 | Inbound action override in a child domain | new override record; parent untouched |

The detailed steps go in `tools/spikes/s19-feature-build/README.md` when the spike is approved.

## 6. Decisions needed

1. **Adopt the per-class contract (section 4)** as an ADR, amending 0031 and 0033: the route per
   class is chosen by snagentic, not left to the agent.
2. **Child deletions (X1):** snagentic emits the `Now.del` for a removed child, shown in the plan
   (recommended), or only refuses until the developer writes it.
3. **Baseline records (X6):** extend-by-new-record first, edit in place only from global with
   `Record()`, and SN-UPG-002 as a warning (recommended), or block.
4. **Protected script includes and flows:** refuse adopt (recommended).
5. **Domain-specific choices:** refuse in 2.x (recommended); no SDK route is both correct and
   checkable.
6. **Fix first, before S19:** B1, B2 (refusal at least), B3, and the X4 normalizations for UI
   policies, which the spike depends on.

## 7. Is the mirror complete for these classes?

Checked offline against the pdi2 mirror (last full pull 2026-10-13, incremental 2026-10-15), its
class catalog and the instance counts recorded at the last pull. For each table, the fields of the
mirrored records were compared with the table's dictionary columns, ancestors included.

**Complete (C):** every column present (scripts as their own files, domain in `_meta`):

| Class | Records | Children |
|---|---|---|
| Inbound email actions | 16 | none |
| UI policies | 3,035 | 5,350 actions, 94 related-list actions |
| UI actions | 2,763 | 569 roles, 239 views; 673 declarative actions |
| Menus, modules | 217, 3,014 | none |
| Roles | 822 | 1,050 containments |
| ACLs | 49,948 | 47,971 roles; 4,750 security attributes |
| Dictionary | 143,359 | 466 overrides; 4,031 choice sets |
| Script includes | 5,798 | none |
| Flows, actions | 404, 588 | v1 and v2 instances, stages, variable values |

**Gaps:**

| Gap | Why | Matters for |
|---|---|---|
| ES-latest mode of a script include (`sys_es_latest_script`) | not a `sys_metadata` class, so never pulled | knowing how a script runs; fixed by M1 |
| Property values (`sys_properties.value`) | every value redacted, one allow-listed | behaviour switches, e.g. inbound email on or off |
| Mail accounts (`sys_email_account`) | not metadata; holds credentials | whether inbound email can work at all |
| Labels, hints, help, plurals (`sys_documentation`) | skipped on purpose (ADR-0033); `column_label` is on the dictionary | form wording |
| UI messages (`sys_ui_message`) | denied class | text of `gs.getMessage` and action messages |
| Connection aliases (`sys_alias`) | denied class; the flow's alias mappings are mirrored | which connection a flow uses |
| Protected scripts | the platform encrypts them | 273 script includes, protected flows |
| About 6,200 of 21,710 choices | their owner name is not a mirrored table, so they are dropped as orphans; 530 of the 537 unmatched names are `var__m_*` (flow, action and test step variables; corrected by M3) | flows and actions; fixed by M3 |
| Records in other domains | full pull lists by class and misses them (ADR-0030 #9); pdi2 has only 14 | domain-separated instances; fixed by M4 |

**Follow-up:** the gaps are addressed by ADR-0034 and `mirror-plan.md` (owner's choice,
2026-10-17): ES-latest rows, typed property values, multi-row variable set choices and other
domains are pulled; mail accounts, aliases and protected code stay out, and `describe` says so.

**Not provable offline:** the instance reported 691,224 `sys_metadata` records at the last pull and
the mirror holds 489,612. Skipped and denied classes should explain the difference, but only
`pull --verify` (read-only, per scope and sys_id prefix) proves it.

## 8. Corrections made while checking

- One analysis reported that `Now.del` on `sys_dictionary` builds nothing. An offline build in
  global gave a correct DELETE unit; the claim is wrong, at least in global (X5 holds the rest).

## 9. Sources

- SDK 4.13.6 (npm, published 2026-10-05; no later release on 2026-10-17)
- ServiceNow SDK guides bundled in `@servicenow/sdk/docs/guides/` (script include, inbound email
  action, override)
- [Customizations tracked by update sets](https://www.servicenow.com/docs/r/SmYvGPN0OygSQs53fsexIQ/fnLzsbSdhPi9tQnTBbAfhA)
- [Client-callable script include privacy](https://www.servicenow.com/community/servicenow-ai-platform-articles/privacy-on-client-callable-script-includes-instance-security/ta-p/2386648)
- [SDK releases](https://github.com/ServiceNow/sdk/releases)
