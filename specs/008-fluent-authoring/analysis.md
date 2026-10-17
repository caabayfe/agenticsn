# 008. Fluent as the only way to author changes: analysis

- Status: Done. ADR-0031 accepted 2026-10-16; the migration is planned in `plan.md`
- Date: 2026-10-16
- Asked by: the product owner (2026-10-16): "move all the logic to the Fluent SDK … if this
  changes the current sync, or the repo structure I am fine … a consistent way to interact with
  the forms, ensuring everything is recorded in the right way, using the right tools that
  ServiceNow provides"
- Builds on: ADR-0028 (flows in Fluent), ADR-0029 and ADR-0030 (layouts and unrecorded classes
  loaded through `fluent/load`)
- Evidence:
  - the embedded SDK 4.13.6 itself (`node_modules/@servicenow/sdk-*`);
  - ServiceNow's releases and announcements (sources in section 9);
  - a map of this codebase's dependence on the YAML record format;
  - the live findings of spikes S11, S13, S14 and S15 on pdi2.

## 1. Summary

**Recommendation: yes, move all authoring to Fluent.** Keep the YAML mirror, but only as the
read-only picture of the instance.

| Today | Proposed |
|---|---|
| Developers edit mirrored YAML records | Developers (and agents) edit Fluent source only |
| Most writes go through the Table API; layouts, jobs and flows through `fluent/load` | Every write goes through `fluent/load`, into the batch's update set |
| snagentic writes its own copies of the SDK's formats (lists, forms, records) | The SDK builds every record; snagentic writes no ServiceNow format |
| The mirror is both what the instance holds and what developers edit | The mirror is only what the instance holds: audit, base checks, search |

**Why:**

- One route and one format for every change, the one ServiceNow's own tools use: the SDK, the
  ServiceNow IDE and Build Agent's skills.
- Everything is recorded by construction. The load writes the platform's own update into the
  batch, including the classes the Table API never records (ADR-0030).
- The SDK knows each record's shape, so we stop rebuilding composite records by hand. That is
  four writers, two contract tests and most of last night's live findings.

**What it does not do: replace the mirror.** Fluent describes what a project owns, not what an
instance holds. Audit, search, advise and the base check need the instance's 1,503 classes,
out-of-box records included. ServiceNow's own `transform` overwrites local work rather than
merging, so it cannot be the way changes come back either.

**The cost:**

- Most of delivery and about half of governance get rewritten.
- Integrate and accelerators change.
- The SDK's maturity becomes our risk. Its transform fidelity is still being fixed release by
  release, and two of the things this design needs are thinly documented:
  - the `configuration` project type;
  - customizing records the project doesn't own.

**Spike S16 tested this on pdi2, and all four tests passed** (section 7). Two parts of the design
changed:

- Records are adopted from the instance through the SDK, not from the mirror.
- The SDK loses a few things, which `adopt`'s field check must name.

Loads recorded every change, including a baseline record and a new ACL without elevation.

## 2. What the SDK covers (embedded 4.13.6)

**Coverage is no longer the obstacle.** The SDK has about 70 typed APIs, and `Record()` writes any
other table.

| Area | Typed APIs (tables) |
|---|---|
| Data model | `Table` (~50 column types, dictionary overrides, `augment` of existing tables), `ChoiceSet`, `DatabaseView`, `StateModel` |
| Server logic | `BusinessRule`, `ScriptInclude`, `ScriptAction`, `ScheduledScript` (`sysauto_script`), server modules (`sys_module`) |
| Client and UI | `ClientScript`, `UiAction`, `UiPolicy`, `UiPage`, `List`, `Form` (form, sections, elements), views, field styles |
| Security | `Acl` (with roles), `Role`, `CrossScopePrivilege`, `DataPolicy` |
| Integration | `RestApi`, `RestMessage`, `GraphQLApi`, `ImportSet` (transform maps), `InboundEmailAction`, `EmailNotification` |
| Process | `Flow`, `Subflow`, `Action`, triggers, stages; `Sla`; `Playbook`; `DataLookup` |
| Catalog and portal | `CatalogItem`, record producers, variables, catalog scripts and policies; `ServicePortal`, `SPWidget`, `SPPage`, themes, menus |
| Workspaces, AI, tests | `Workspace`, `Dashboard`, `AiAgent`, `NowAssistSkillConfig`, ATF `Test` and `TestSuite`, instance scan checks |
| Anything else | `Record({ table, data })`: related lists, modules, fix scripts, UI scripts, events, relationships |

**The SDK features this design relies on:**

| Need | SDK feature |
|---|---|
| Delete a record | `Now.del(table, keys)`: an explicit, reviewable deletion (4.8) |
| Set a field the API doesn't expose, including `sys_domain` | `$override` (4.7, 4.10) |
| Bring existing records into source | `transform --from <xml>`: offline, with no credentials; scripts become `Now.include` files (4.13) |
| Global scope | global applications (4.4, needs the Australia release); `move` claims baseline records into a global app |
| Script code | inline, `Now.include('file.js')`, or TypeScript server modules |

**The gaps that matter:**

- **`configuration` projects are barely documented.** They're the type that loads into an update
  set rather than installing an application. snagentic already uses them for flows (ADR-0028
  amendment). In this type, deletions come only from `Now.del`, never from `keys.ts`.
- **The SDK's lifecycle guide says customizing records it doesn't own is out of scope.** That
  means "edit in place" of baseline records outside global apps. `Record()` with the record's
  sys_id does build such an update, but nobody has proven that the load records it correctly.
- **Domains have only `$override.sys_domain`.** A 2026-06 report says records installed into the
  global domain. We loaded domain lists correctly (ADR-0029), but that was our own XML, not the
  SDK's.
- **`Record()` applies no platform defaults.** A new record gets only the fields the source
  names.
- **ServiceNow says design-time UI behaviours will never have full parity.** That covers what
  the form designer or the list editor does around a save.

## 3. What ServiceNow is doing

- **Fluent is the pro-code and agent path.** At Knowledge 2026 (2026-05-06), Build Agent's skills
  shipped through the SDK for Cursor, Windsurf, Claude Code and Copilot. They work "across the
  entire platform, including out-of-the-box applications".
- **Update sets stay first-class.** Studio's Build Agent records every step in update sets.
  ServiceNow presents Fluent as an addition to update sets, not a replacement.
- **The SDK moves fast.** It released 4.4 to 4.13 between March and October 2026, and many of
  those releases fixed transform data loss. Pin the version, and test each upgrade (ADR-0028
  already requires this).
- **Our evidence disagrees with one public statement.** A 2025 maintainer comment says SDK
  installs don't record update sets. That's true of `now-sdk install` for an application package.
  `fluent/load` with `targetUpdateSetId`, the route we use, recorded every load in the batch on
  pdi2 (S11, S15, the ADR-0030 runs).

## 4. Target design

```
instances/<name>/metadata/...    mirror: read-only, written only by pull (unchanged format)
source/<scope>/                  one Fluent project per scope, global included: the only thing edited
  now.config.json                type "configuration"
  src/fluent/**/*.now.ts         records; scripts in Now.include files or server modules
  src/fluent/generated/keys.ts   $id -> sys_id, committed
```

| Step | Today | Proposed |
|---|---|---|
| Start work on a record | edit its YAML | `adopt` (new use case): the SDK reads the record from the instance (`transform --table --id`, one read) into the scope's project. A reviewable commit. Not from the mirror: S16 F1 showed the mirror's raw values lose the reference keys `transform` needs |
| Plan | diff YAML against the mirror; route each class | build the changed projects; diff each built record against its mirror copy, field by field. The plan lists records as today |
| Base check (ASR-02) | YAML `_meta` hash against the instance | each built record's mirror copy, at the commit it was adopted or last pushed from, against the instance. Unchanged rule |
| Gate | YAML records and their scripts | the built records (same record checks) and the source scripts (the same ESLint rules, with context from the built record). This also closes a gap: today no script rule runs on Fluent source |
| Push | Table API, `fluent/load`, publish | `fluent/load` per scope into the batch, flows published, capture verified. The elevated session stays for ACLs if the load needs it (spike) |
| Pull | unchanged | unchanged. Then integrate tells source from instance |
| Instance edits made in the UI | integrate merges them into YAML | integrate reports adopted records whose mirror copy changed (drift). `adopt --refresh` re-reads them with the SDK on a branch from the base commit, and git merges that with local work (S16 F4: a clean merge of both sides). The SDK alone would overwrite local work |

**What goes away:**

- the Table API write path;
- the layout writers and their kinds;
- the `update_synch` routing and dictionary reads (everything is loaded);
- the related-list pairing in integrate;
- the YAML edit rules: editable child tables, protected paths.

**What stays:** pull, the mirror, knowledge, `find`, `describe`, `advise`, update set reads, the
plan id, the gate, the journal and the batch update sets.

**Accelerators** become Fluent packs, adopted into the workspace's projects.

## 5. Impact on this codebase

From a map of the code's dependence on the YAML format:

| Area | Size (lines) | Impact |
|---|---|---|
| sync (pull, mirror) | 2,800 | **Unchanged**: it becomes purely the read model |
| knowledge, find/describe/advise | 2,100 | Unchanged |
| delivery | 4,100 | **Mostly rewritten:**<br>• planning becomes "build and diff against the mirror";<br>• push keeps the scope loop, journal, update sets and capture;<br>• the layout writers (~1,000) and record routing are deleted |
| governance | 850 | **Half rewritten:** `validate` reads built records and source scripts instead of changed YAML |
| rules-basic (22 script rules) | 660 | Unchanged: same AST rules. Only their context source changes |
| git adapters (integrate) | 1,200 | Simpler: no record-aware merge fix-ups. Drift is reported instead |
| accelerators | 1,800 | Rewritten as Fluent packs |
| new | — | `adopt`, record XML from the mirror (exists: `recordUpdateXml`), drift report, gate input from built records |
| agent packs, docs | — | **Rewritten:**<br>• the build skill becomes "find, adopt, edit Fluent, validate";<br>• agents read `now-sdk explain` (embedded) |

Use cases: `adopt` is added, and replaces editing. The MCP budget is unchanged (`plan_push`,
`push` and `validate` keep their names).

## 6. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| The load doesn't record, or mis-records, a record the project doesn't own (out-of-box customizations, other scopes) | Low after S16: a baseline business rule loaded from a global project was recorded and stayed in its package | Test more kinds of baseline record in M5. Fallback: those records stay YAML through the Table API |
| `configuration` projects change or disappear in an SDK release | Low to medium | Pinned SDK; a live contract test on every upgrade (ADR-0028) |
| Transform loses fields (fixed through 4.13) | Medium | `adopt` builds the transformed source and compares it field by field with the mirror before committing; it refuses on any difference |
| Domains | Medium | Spike F3; `$override.sys_domain`, checked by the same field comparison |
| Agents write worse Fluent than YAML | Low: ServiceNow trains its agents on it | Agent evaluations (`scripts/eval`) before and after |
| `fluent/load` is not a public API | Known (ADR-0028) | The live contract test already exists |
| Bigger builds slow plan and validate | Low | Build only the changed projects; budget ASR-04 for `check` stays on single files |

## 7. Spike results (S16, pdi2, 2026-10-16)

Evidence: `tools/spikes/s16-fluent-authoring/README.md`.

| Test | Result | Consequence for the design |
|---|---|---|
| F1 Converting existing records | **Passes from the platform's XML, fails from the mirror's.** The mirror's raw values lack the reference keys `transform` needs (wrong parent table; forms given new keys). From the platform's XML, every authored field survives except a short list of SDK losses: Default-domain choices, table licensing configs, one reference written as its display value, and a few API defaults | `adopt` reads through the SDK from the instance. Its field check compares the build with the mirror and names each loss, so known losses are refused or listed in the plan |
| F2 Load and capture | **Passes.** 12 changes of 10 kinds were recorded under the platform's update names, in the scoped and the global set. They include a new ACL **with no elevated session**, and a baseline business rule (kept in its plugin package) | One route really does record everything. The elevated session for ACLs (ADR-0024) can retire. Two old problems stay:<br>• loads don't stamp `sys_mod_count` and `sys_updated_on`, so push still stamps the built XML (ADR-0030 item 5);<br>• named-view placeholders change on every build, so the plan digest normalizes them |
| F3 Domains and deletions | **Passes.** Domain lists and sections were updated in place. `Now.del` deletes. A `configuration` project never deletes implicitly | A deletion is always an explicit `Now.del`. The gate refuses a definition removed without one |
| F4 Edits made on the instance | **Passes.** The SDK refreshes only the changed properties, and git merged local and instance edits cleanly; the merged build loaded correctly | As designed |

**Still open:**

- moving a batch to a second instance (F5);
- refreshing after a form designer edit (does a `Form()` file get a small diff?);
- a conversion larger than one application.

## 7a. The spikes as planned (pdi2, about two days)

**F1. Brownfield round trip.** Adopt from the mirror, with no edits, then build and diff against
the mirror. Run it on:

- the whole Access Review application (210 records);
- an out-of-box business rule;
- `incident`'s Default form and list;
- a related list.

Proves: transform fidelity, and whether Fluent can describe what we have today.

**F2. Load and capture.** Load F1's projects with one field changed per record, into a batch.
Proves:

- every record is recorded under the right update name, for owned and not-owned records alike;
- related lists and sections behave as in S15;
- an ACL either loads without elevation or needs it.

**F3. Domains and deletes.**

- `$override.sys_domain` on a section and a list;
- `Now.del` on a record and on a list element, in a `configuration` project.

**F4. Drift.** Edit a loaded record in the form designer, pull, then `adopt --refresh` with a local
edit pending. Proves the merge in git.

Then, with a second instance, **F5**: move the batch and compare (spec 004 promotion).

## 8. Migration plan, after the spikes

| Phase | Delivers |
|---|---|
| M1 | `adopt` (mirror → XML → offline transform → field check), and source-only planning for adopted records. YAML editing still works |
| M2 | Gate on built records and source scripts; drift report in integrate |
| M3 | All writes through `fluent/load`; the Table API write path and the layout writers are removed; editing YAML is refused by `check` and the hooks |
| M4 | Accelerators as Fluent packs; build skill, instructions, getting started; a workspace migration command (`adopt` everything a branch changed since the mirror) |
| M5 | Live end-to-end on pdi2: the ADR-0030 matrix and the Access Review application rebuilt from source. Then release as 2.0.0: the workspace format changes |

ADR-0029 and ADR-0030 stay valid as findings. Their writers are replaced by the SDK's build, and
their platform rules (stamping, domain queries, related-list recreation) still apply to the load
and the mirror.

## 9. Sources

- SDK: <https://github.com/ServiceNow/sdk/releases> (4.4–4.13.6),
  <https://servicenow.github.io/sdk/guides/developing-apps-guide>,
  <https://github.com/ServiceNow/sdk/discussions/21>, `/40`, `/79`
- Build Agent: <https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-Build-Agent-now-works-inside-every-major-AI-coding-tool-governed-by-default/default.aspx>,
  <https://www.servicenow.com/community/product-launch-blogs/australia-the-release-where-ai-delivers-for-developers/ba-p/3536992>,
  <https://www.servicenow.com/community/product-launch-blogs/build-anywhere-run-on-servicenow-deploying-from-external-ides/ba-p/3522466>
- Embedded SDK: `sdk-api/dist/plugin-registry.js`, `sdk-build-plugins/dist/*-plugin.js`,
  `sdk-api/dist/orchestrator.js` (transform), `sdk-build-core/dist/now-config.js` (project
  types), `docs/guides/sdlc-guide.md`, `docs/fluent/override-guide.md`, `now-del-guide.md`
