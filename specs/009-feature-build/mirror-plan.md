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
| M3 | Keep the choices of multi-row variable sets | bug | ADR-0025 |
| M4 | List other domains' records in a full pull | bug | ADR-0030 #9 |
| M5 | `describe` names what the mirror leaves out | addition | ADR-0034 #3 |

Out of scope, on purpose (ADR-0034 #3): mail accounts, connection aliases, connections and
credentials, protected code. Also out: labels and UI messages (`sys_documentation`,
`sys_ui_message`), the per-class authoring contract and bugs B1–B3 (`analysis.md` section 6), and
storage optimization.

Order: M4 and M3 first (defects in what is already promised), then M1, M2, M5. Each milestone is
one branch and one pull request, test-first, `bun run verify` green before every commit.

## 3. Milestones

### M1. ES-latest rows

**Facts.** `sys_es_latest_script` has `id` (the owning script's sys_id), `table` (its class) and
`use_es_latest`. The SDK emits it as its own update, `sys_es_latest_script_<sys_id>`, next to the
script include (seen in an offline SDK build during the spec 009 analysis).

**Change.**
- Add `{ table: "sys_es_latest_script", parentField: "id", ownerClasses: ["sys_script_include"] }`
  to `CHILD_TABLES` (`packages/core/src/metadata/domain/child-tables.ts`). The file is
  `<script include>.children.sys_es_latest_script.yaml`. Rows whose `id` names another mirrored
  record attach to it too; the rest are orphans, as for any child table.
- Full and incremental pulls already handle child tables; the incremental pull gains one
  fingerprint for the new table.

**Tests (failing first).**
- `it("keeps a script include's ES-latest row beside it")` (full pull, fake instance).
- `it("refreshes a changed ES-latest row in an incremental pull")`.
- `it("removes the ES-latest file when the row is deleted")`.
- Golden file for the child file's layout.

**Open question, checked before merging.** ADR-0033 reads a unit's live copy by sys_id or by
the keys the platform coalesces on. The SDK gives the row its own sys_id, which won't match the
instance's existing row. If the platform doesn't coalesce `sys_es_latest_script` on `id` and
`table`, an adopted script include whose mode is changed would create a second row. M1 checks it
on pdi2 (one read and one load in a scratch application) and, if needed,
adds the coalescing keys to the plan's live read. If the platform doesn't coalesce, push refuses
an ES-latest change on an existing script include, with a hint, until a route is found.

**Done when:** pdi2's script includes have their ES-latest files after a pull; an incremental
pull with no changes still meets ASR-16 (measured, reported in the pull request).

### M2. Typed property values (ADR-0034)

**Change.**
- `fieldsToRedact` (`packages/core/src/metadata/domain/redaction.ts`) takes the record's row, not
  only its name, and keeps `value` under ADR-0034 #1: kept type, `is_private` false, name not
  secret-like, value shaped like its type. The allow-list route is unchanged.
- The shape checks are a small pure table, one entry per kept type.
- `RedactionPolicy` gains a `version`. The pull state stores the version it last applied. On a
  mismatch the next pull re-reads the classes whose redaction changed (`sys_properties`), then
  stores the new version.
- The pull report counts values redacted because they failed their shape check.

**Tests (failing first).**
- `it("keeps the value of a boolean property")`, and one per kept type.
- `it("redacts a string property's value")`, `it("redacts a password2 property's value")`.
- `it("redacts a private property's value even when it is a boolean")`.
- `it("redacts a value named like a secret even when it is an integer")`.
- `it("redacts an integer property whose value is not a number")`.
- `it("re-reads properties once when the redaction policy changes")`, and
  `it("does not re-read them on the next pull")`.
- Property (fast-check): no value of a non-kept type is ever written, whatever its content.
- The mirror secret-scan test runs over kept values.

**Done when:** a pull of pdi2 keeps about 2,650 values and no string, password, image or private
value (counted from the mirror); the secret scan is clean; the changelog names the one-time diff.

### M3. Choices of multi-row variable sets

**Facts.** About 6,200 of 21,710 choices are dropped as orphans, because their `name` is not a
mirrored table. 530 of the 537 unmatched names are `var__m_*`: the tables behind multi-row
variable sets, which have no mirrored `sys_db_object`.

**Change.**
- Step 1, offline: establish from the mirror what a `var__m_*` name points to (the variable set,
  `item_option_new_set`, by internal name or sys_id) and what the other 7 names are. Record it in
  this plan before writing code.
- Step 2: give those choices an owner. Preferred: the variable set record, through a second
  owner lookup for names that are not tables. Fallback: keep them under their own
  `sys_choice` files keyed by name, if no owner is mirrored.
- The pull report already counts orphans; it then names the unowned tables (at most ten) so the
  next gap is visible.

**Tests (failing first).**
- `it("keeps a multi-row variable set's choices with the set")`.
- `it("names the tables whose choices had no owner")`.

**Done when:** orphan choices on pdi2 drop from about 6,200 to the unexplained remainder, which
the report names.

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

### M5. `describe` names what the mirror leaves out (ADR-0034 #3)

**Change.**
- One domain table in `packages/core/src/knowledge/domain/`: each omission with the classes it
  concerns, a one-line reason and, where relevant, the mirrored records that stand in for it
  (for inbound email, the properties that switch it on or off).
- `describeRecord` gains `notMirrored: string[]`:
  - a record whose `sys_policy` is `protected`: its code is protected and not readable;
  - an inbound email action: mail accounts aren't mirrored; the inbound email properties, with
    their values when M2 keeps them;
  - a flow or action with alias mappings: connection aliases aren't mirrored.
- `describeTable` adds the omissions that apply to the table to its existing `notCovered`.
- Regenerate `docs/reference/commands.md` (`bun run docs`) if the output schema text changes.

**Tests (failing first).**
- `it("says a protected script include's code is not readable")`.
- `it("says mail accounts are not mirrored when describing an inbound email action")`.
- `it("says connection aliases are not mirrored when describing a flow that maps one")`.
- `it("lists no omission for a record they don't concern")`.
- Golden output for one record of each kind.

**Done when:** the three cases read correctly against the pdi2 mirror; no new MCP tool, command or
skill (ASR-09).

## 4. Live checks (pdi2)

pdi2 is a test instance; checks may write to the scratch scope. Coordinate with other sessions
before writing (pushes switch the user's application and update set). Never touch the
`spaces/pdi2` workspace; use `spaces/pdi2-fluent`.

| Check | Milestone | Writes |
|---|---|---|
| ES-latest coalescing: read one row, load a changed mode for one scratch script include | M1 | yes, scratch scope |
| Pull with no changes still meets ASR-16 | M1 | no |
| Property values kept and redacted, counts match section M2 | M2 | no |
| Choice orphans after M3 | M3 | no |
| A record in another domain is listed (passed 2026-10-17) | M4 | no |

## 5. Risks

- **A secret in a kept property.** Mitigated by five independent checks (ADR-0034 #1); the
  property-based test and the secret scan guard regressions.
- **ES-latest duplicates** if the platform doesn't coalesce: found by M1's live check before
  merging; push refuses until resolved.
- **Mirror churn**: M2 changes about 2,650 files once, M3 adds choice files, M4 adds records. Each
  lands in its own pull commit, named in the changelog.
- **Incremental pull cost**: one more fingerprint (M1). Measured against ASR-16, not assumed.

## 6. Release

The five milestones ship together as one minor release (2.1.0), after security fixes S1 and S2,
which are already open and are not part of this plan.
