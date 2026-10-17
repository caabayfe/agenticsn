# 009. A mirror complete enough to build a feature: plan

- Status: Approved by the product owner on 2026-10-17, with ADR-0034
- Date: 2026-10-17
- Decision: ADR-0034 (typed property values; omissions named by `describe`)
- Builds on: ADR-0017 (child rows), ADR-0025 (choices), ADR-0030 #9 (domains in pulls), ADR-0033
  (plans compare with the instance)
- Evidence: `analysis.md` section 7 (pdi2 mirror, full pull 2026-10-13, incremental 2026-10-15)

## 1. Goal

An agent that reads the mirror can explain and build a feature made of inbound email actions, UI
policies, UI actions, modules, roles, ACLs, dictionary entries, choices, script includes and
flows. What the mirror holds is complete. What it leaves out, it says it leaves out.

## 2. Scope

| # | Work | Kind | Decision |
|---|---|---|---|
| M1 | Pull ES-latest rows as child rows of script includes | addition | ADR-0017 |
| M2 | Keep the values of typed, non-private properties | safety rule loosened | ADR-0034 #1, #2 |
| M3 | Keep the choices of flow, action and test step variables | bug | ADR-0025 |
| M4 | List other domains' records in a full pull | bug | ADR-0030 #9 |
| M5 | `describe` names what the mirror leaves out | addition | ADR-0034 #3 |

Out of scope, on purpose (ADR-0034 #3): mail accounts, connection aliases, connections and
credentials, protected code. Also out: labels and UI messages (`sys_documentation`,
`sys_ui_message`), the per-class authoring contract and bugs B1–B3 (`analysis.md` section 6), and
storage optimization.

Order: M4 and M3 first (defects in what is already promised), then M1, M2, M5. Each milestone is
one branch and one pull request, test-first, `bun run verify` green before every commit.

## 3. Milestones

### M1. ES-latest rows (done 2026-10-17)

**Facts.** `sys_es_latest_script` has `id` (the owning script's sys_id), `table` (its class) and
`use_es_latest`. On pdi2: 4,970 rows over 79 script classes, 1,224 of them for script includes.

**Change, as built.** `{ table: "sys_es_latest_script", parentField: "id", ownerClasses:
["sys_script_include"] }` in `CHILD_TABLES`. The file is `<record>.children.sys_es_latest_script
.yaml`. A row attaches to whichever mirrored record its `id` names, so business rules and REST
operations get theirs too. Its fingerprint makes 22 change sources (ASR-16 text updated); an
existing mirror lists the table on its first incremental pull, as for any child table it never
read.

**Open question, answered without writing (read-only, pdi2).** The plan feared that a build gives
the row a new sys_id and the load creates a second row. It doesn't:
- the platform's unload export (`/api/sn_glider/metadata/unload/<sys_id>`), which `adopt` reads,
  holds the ES-latest row with its real sys_id, inside the script include's update;
- the SDK keys the row as a composite on `id` and `table` (its `EsLatestScriptPlugin`), so the
  adopted source keeps that sys_id in `keys.ts`;
- the SDK writes the row inside the script include's update file, as the platform does: it is
  part of the script include's unit (ADR-0033), not a unit of its own.

The write check planned in section 4 is therefore not needed. What remains is bug B1
(`analysis.md`): the comparison ignores the nested row, so a change to `useEsLatest` alone is not
seen as a change. It is fixed with B1, not here.

**Tests.** `packages/core/test/sync/pull-es-latest.test.ts`:
- `it("keeps a script include's ES-latest row beside it")`;
- `it("refreshes a changed ES-latest row in an incremental pull")`;
- `it("removes the ES-latest file when the row is deleted")`;
- `it("attaches the ES-latest row of a script include created since the last pull")`;
- `it("lists every ES-latest row on the first pull after an upgrade")`.

### M2. Typed property values (ADR-0034) (done 2026-10-17)

**Change, as built.**
- `propertyValueVerdict(row, policy)` (`packages/core/src/metadata/domain/redaction.ts`) answers
  `kept`, `redacted` or `malformed`. `fieldsToRedact` now takes the row, not only its name. Kept
  types and their shapes are one table. A kept value must also pass `redactSecrets` unchanged.
  `is_private` must be exactly `false`: an unknown privacy redacts.
- `RedactionPolicy.version` is 2. The full pull's checkpoint and the sync state record the
  version applied; a full pull resumed from an older checkpoint keeps the older version, so its
  early classes are re-read too.
- When the state's version is older (absent means 1), the next incremental pull lists
  `sys_properties` again whole and lists `sys_choice` again as never read (M3's choices), once
  (`packages/core/src/sync/domain/redaction-upgrades.ts`, `application/redaction-reread.ts`).
- The record part of the incremental pull moved to `incremental-record-phase.ts` (size limits).
- Both pull summaries count malformed values; the CLI prints them, and the tables read again,
  only when there are any.

**Found while building: no mirror secret scan exists.** ASR-08's fit criterion ("secret scan of
the mirror is a mandatory pull step") isn't implemented anywhere. M2 doesn't depend on it (see
the ADR's implementation note). Recommended follow-up, outside this plan: a pull step that scans
the files a pull writes with the same patterns and refuses to commit a match.

**Tests.** `packages/core/test/metadata/property-values.test.ts` (every kept type, every redacted
type, private, unknown privacy, secret names, shapes, credential-like values, exact type match,
allow-list, and a fast-check property: no value of another type is ever kept) and
`packages/core/test/sync/pull-property-values.test.ts` (values in the mirror, malformed counts in
full and incremental pulls, the one-time re-read, older state, unreadable properties).

**Live check (pdi2, read-only, values never printed).** 4,254 properties: 2,645 kept (1,583
boolean, 830 integer, 166 choice, 53 colour, 12 formats and zones, 1 allow-listed string), 1,602
redacted (every string, password, image and private value), 7 malformed (4 choices, 3 integers).

### M3. Choices of flow, action and test step variables (done 2026-10-17)

**Facts, established before coding.** The analysis guessed these were catalog multi-row variable
sets; they are not. A `var__m_*` name is `var__m_<variable table>_<model sys_id>`: the table
behind the variables of a flow, an action, an ATF step and similar models. On pdi2 (530 names,
5,994 choices):

| Owner | Names | Choices |
|---|---|---|
| A mirrored record (flow, action type, ATF step config, step definition, UX component…) | 327 | 3,456 |
| A flow or action snapshot (pull skips them as derived) | 185 | 2,538 (with the next row) |
| A record that no longer exists | 18 | |

The other 7 unmatched names (`ata`, `bsas`, `eta`, `fsas`, `hybrid`, `xata`, `xsas`) are stray
values, not tables. Dropping the snapshot and stray choices is correct.

**Change, as built.**
- `variableModelOf(name)` (`packages/core/src/sync/domain/pull-scope.ts`) reads the model's sys_id
  from a variable table name. A choice whose name has no table record falls back to the record
  with that sys_id, in the file `<record>.children.sys_choice.yaml`.
- Incremental pulls refresh such a record's choices under all of its variable table names, which
  one aggregate (`sys_choice` grouped by `name`, `nameSTARTSWITHvar__m_`) gives. It is made only
  when choices changed, so a pull with no changes costs nothing more (ASR-16). The query was run
  read-only on pdi2.

**Dropped from the plan:** naming the unowned tables in the pull report. The remaining orphans are
snapshot choices, by design; naming them would be noise.

**Existing mirrors** gain a record's variable choices when that record's choices next change, or
on a full pull. M2's re-read on a version change also re-lists choices once, so every mirror
converges without a manual full pull.

**Tests.** `packages/core/test/sync/pull-choices.test.ts` and `pull-scope.test.ts`:
- `it("attaches a variable's choices to the record that defines the variable")`;
- `it("leaves out the choices of a variable whose record is not mirrored")`;
- `it("refreshes a flow's variable choices whole when one of them changed")`;
- `it("adds the choices of a variable added to a flow")`;
- `it("removes a flow's choice file when its variables' choices are all deleted")`;
- `variableModelOf` names the model for well-formed names only.

### M4. Other domains in pulls (done 2026-10-17)

**Facts.** A full pull lists each class with `sys_class_name=<class>`, and the instance hides
records of other domains from any listing with a condition (ADR-0030 #9). The client already sent
`sysparm_query_no_domain=true` when a query set `allDomains`, for authoring reads.

**Change, as built.** Every listing of metadata sets `allDomains`, not only the full pull's,
because each one has a condition and the same blind spot:
- full pull: records and child rows;
- incremental pull: the change, install and delete feeds, the download by sys_id, and the child
  feeds and listings;
- the check that a replaced record is gone (otherwise a record in another domain could be removed
  from the mirror);
- `pull --verify` listings.

The operational inventory (plugins, store apps) keeps the session's domain: it isn't metadata.

**Dropped from the plan:** the warning when the credential may not query across domains. Nothing
cheap tells the two cases apart, and the live check showed an admin credential is honoured.

**Tests.** `packages/core/test/sync/pull-domains.test.ts`: the shared fake instance now hides rows
of other domains unless a query asks for every domain.
- `it("lists records and child rows of every domain in a full pull")`;
- `it("picks up a change to a record in another domain")`;
- `it("refreshes the child rows of an owner when a row in another domain changed")`;
- `it("recovers a record in another domain when verifying")`;
- `it("keeps the session's domain for the operational inventory")`.

**Live check (pdi2, read-only, passed).** `tests/live/domains.test.ts`, on the form section `acme`
of `x_2222332_s11` (domain `09ff3d10…`): with the session's domain the listing returned 0 rows,
with every domain 1. The aggregate count used by fingerprints and `--verify` already counts it, so
change detection needs no change.

### M5. `describe` names what the mirror leaves out (ADR-0034 #3) (done 2026-10-17)

**Change, as built.**
- `packages/core/src/knowledge/domain/omissions.ts`: the omissions, the classes they concern and
  their wording; a new omission is one entry and a test.
- `describeRecord` returns `notMirrored`:
  - a record whose `sys_policy` is `protected`: its code is protected and not readable;
  - an inbound email action (`sysevent_in_email_action`): mail accounts aren't mirrored, and
    the value of `glide.email.read.active` (kept since M2), or that the mirror doesn't hold it;
  - a flow or action with an input of `reference: sys_alias` (`sys_hub_flow_input`,
    `sys_hub_action_input`, found among the records that name it), and such an input itself:
    connection aliases and connections aren't mirrored.
- `describeTable` adds to `notCovered` how many active behaviour items have protected code.
- The CLI prints both (`not in the mirror: …`, `not covered: …`); MCP returns them as data.
- `sys_policy` joins the index's key fields; the index schema version goes to 5, so existing
  indexes are rebuilt from the files once.

**Tests.** `packages/core/test/knowledge/describe-omissions.test.ts` (protected record, inbound
action with and without the switch, flow mapping an alias, an unconcerned record, a table with
protected behaviour) and the CLI's describe tests.

**Not run live, on purpose.** Describing pdi2's workspace with the new index version would
rebuild the index other sessions share with the released binary, which would rebuild it back.
The classes concerned on pdi2 (`analysis.md`): 273 protected script includes, 16 inbound email
actions, 70 flow and 132 action inputs taking an alias.

## 4. Live checks (pdi2)

pdi2 is a test instance; checks may write to the scratch scope. Coordinate with other sessions
before writing (pushes switch the user's application and update set). Never touch the
`spaces/pdi2` workspace; use `spaces/pdi2-fluent`.

| Check | Milestone | Writes |
|---|---|---|
| ES-latest rows: counts and the unload export (read-only, done 2026-10-17) | M1 | no |
| Pull with no changes still meets ASR-16 | M1 | no |
| Property verdicts on all 4,254 properties (done 2026-10-17) | M2 | no |
| Variable-table aggregate query (run 2026-10-17) | M3 | no |
| A record in another domain is listed (passed 2026-10-17) | M4 | no |

## 5. Risks

- **A secret in a kept property.** Mitigated by five independent checks (ADR-0034 #1); the
  property-based test and the secret scan guard regressions.
- **ES-latest duplicates**: ruled out by M1's read-only check; the remaining gap is B1.
- **Mirror churn**: M2 changes about 2,650 files once, M3 adds choice files, M4 adds records. Each
  lands in its own pull commit, named in the changelog.
- **Incremental pull cost**: one more fingerprint (M1). Measured against ASR-16, not assumed.

## 6. Release

The five milestones ship together as one minor release (2.1.0), after security fixes S1 and S2,
which are already open and are not part of this plan.
