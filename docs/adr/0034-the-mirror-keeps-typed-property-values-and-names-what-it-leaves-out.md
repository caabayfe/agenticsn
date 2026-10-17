# 0034. The mirror keeps typed property values and names what it leaves out

- Status: Accepted (product owner, 2026-10-17)
- Date: 2026-10-17
- Requirements: ASR-08 (data protection), ASR-07 (instance scale), ASR-16 (instance load),
  ASR-10 (reviewability)
- Relates to: 0017 (flat record layout), 0025 (choices as child rows), 0030 #9 (domains in pulls),
  0033 (plans compare with the instance)
- Analysis: `specs/009-feature-build/analysis.md`, section 7
- Plan: `specs/009-feature-build/mirror-plan.md`

## Context

Spec 009 checked whether the mirror holds what an agent needs to explain and build a complete
feature: inbound email actions, UI policies, UI actions, modules, roles, ACLs, dictionary entries,
choices, script includes and flows. The records of those ten classes are complete. Four gaps are
not:

1. **ES-latest mode.** Whether a script include runs with the latest ECMAScript engine is stored
   in a separate row, `sys_es_latest_script` (`id` = the script's sys_id, `table`,
   `use_es_latest`). It is not a `sys_metadata` class, so pull never reads it. The SDK builds that
   row as its own update (`sys_es_latest_script_<sys_id>`).
2. **Property values.** Every `sys_properties.value` is redacted, except one allow-listed name.
   Behaviour switches that a feature depends on are invisible, for example whether inbound email
   is read at all. On pdi2, 4,250 properties:

   | Type | Count | Of which private |
   |---|---|---|
   | boolean | 1,646 | 60 |
   | string | 1,474 | 68 |
   | integer | 854 | 21 |
   | choicelist | 181 | 11 |
   | color | 53 | 0 |
   | time_format, date_format, timezone | 13 | 1 |
   | image, uploaded_image | 13 | 0 |
   | password, password2 | 11 | 2 |
   | short_string, other | 5 | 0 |

   `is_private` marks a property the platform keeps out of update sets: an instance-specific
   value.
3. **Dropped choices and domain records.** Two pull defects, not decisions:
   - about 6,200 of 21,710 choices are dropped as orphans, because the table they name is not a
     mirrored `sys_db_object`; 530 of the 537 unmatched names are multi-row variable set tables
     (`var__m_*`);
   - a full pull lists each class by `sys_class_name` and so misses records in other domains
     (ADR-0030 #9). The client already supports `sysparm_query_no_domain` for authoring reads.
4. **Things left out on purpose.** Mail accounts (`sys_email_account`), connection aliases and
   their connections (`sys_alias`, `sys_connection`, credentials), and the code of protected
   scripts. Today `describe` is silent about them, so an agent can conclude that an inbound email
   action works or that a script include has no code.

Items 1 and 3 fit existing decisions (ADR-0017 child tables, ADR-0025 choices, ADR-0030 #9) and
need no new decision. Item 2 loosens a safety rule (ASR-08), and item 4 sets a boundary that was
being reconsidered. Both are decided here.

## Decision

1. **A property's value is kept when all of these hold:**
   - its `type` is one of `boolean`, `integer`, `choicelist`, `color`, `date_format`,
     `time_format`, `timezone`;
   - `is_private` is `false`;
   - its name doesn't match the secret-name pattern (`SECRET_PROPERTY_NAME`);
   - the value has the shape of its type: `true` or `false`; an optional sign and digits; a
     choice of at most 80 characters with no whitespace; a colour, format or zone of at most
     40 characters.

   Every other value stays redacted, `string` and `short_string` included, unless its name is on
   the reviewed allow-list, as today. A value that fails its shape check is redacted and counted
   in the pull report, never kept. The mirror's secret scan still runs over every kept value.

   On pdi2 this keeps about 2,650 of 4,250 values (62 %) and keeps every string, password, image
   and private value out.
2. **The redaction policy has a version**, stored with the mirror's pull state. When the version
   changes, the next pull, full or incremental, re-reads the classes whose redaction changed
   (here `sys_properties`, a few pages on pdi2), so that existing mirrors converge without a
   manual full pull. This is the measured reason for the extra requests (ADR-0016).
3. **Left out on purpose, and said so.** The mirror doesn't hold:
   - mail accounts (`sys_email_account`): they hold credentials and are not metadata;
   - connection aliases, connections and credentials (`sys_alias`, `sys_connection` and its
     subclasses, the credential and profile classes): they stay denied;
   - the code of protected scripts: the platform doesn't return it, and decrypting it would break
     the vendor's protection.

   `describe` names these omissions where they matter, as data, not prose in a skill:
   - a protected record says its code is protected and not readable, rather than showing an empty
     script;
   - an inbound email action says mail accounts aren't mirrored, and names the properties that
     switch inbound email on or off, with their values when kept;
   - a flow or action that maps a connection alias says aliases aren't mirrored;
   - a table description lists the omissions that apply to it, in its existing `notCovered`
     list.

   The list of omissions lives in one domain table, so a new omission is one entry and a test.

## Consequences

- Agents can read behaviour switches (booleans, limits, modes) from the mirror, and explain why a
  feature does or doesn't run.
- A secret stored in a property of a kept type would now reach the mirror. The checks against
  that are the type list, the private flag, the name pattern, the shape check and the secret scan.
  A boolean, integer or short choice can't carry a credential that passes all five.
- Existing mirrors change once: about 2,650 property files gain their value, in one pull commit.
  That diff is expected and the changelog says so.
- Adopting a property (ADR-0033) still never takes a redacted value from the instance; security
  finding S2 (adopt writing secrets unredacted) is fixed separately and is not loosened here.
- `describe` gets longer by a few lines for the classes concerned. No new tool, command or skill
  (ASR-09).
- An agent still can't see mail account settings, alias targets or protected code. It is told so,
  and can ask a person.

## Note on implementation (2026-10-17)

The mirror-wide secret scan this ADR relies on (ASR-08's fit criterion) doesn't exist in the code.
Rather than depend on it, a kept value is also checked against the credential patterns
snagentic uses to clean logs and errors (`redactSecrets`): a value they would change is redacted
and counted as malformed. The decision is unchanged. The missing scan is a separate gap against
ASR-08, recorded in `specs/009-feature-build/mirror-plan.md`.

Measured on pdi2 with the rule as built (read-only, values not printed): 2,645 of 4,254 values
kept (one of them the allow-listed vendor prefix), 1,602 redacted, 7 redacted as malformed.

## Alternatives considered

- **Keep redacting every value.** Rejected: the most common question about a feature ("is it on?")
  stays unanswerable, and agents guess.
- **Keep every value except secret-looking names.** Rejected: `string` properties hold URLs with
  tokens, hostnames and free text; a name pattern can't prove a value safe.
- **Allow-list property names one by one.** Kept as the route for `string` values, but rejected as
  the only route: thousands of names, and new ones with every plugin.
- **Pull aliases and connections without credentials** (proposed earlier in this session).
  Rejected by the product owner: it narrows a deny-list for a small gain, and the alias mappings a
  flow uses are already mirrored.
- **Recover protected code.** Rejected: it breaks the vendor's protection and licence terms.
