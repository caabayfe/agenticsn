# Spike S17: the SDK behind snagentic's connector (spec 008, M0)

pdi2 (Australia), SDK 4.13.6, 2026-10-16. Not product code.

| Script | Does |
|---|---|
| `transform.ts` | The SDK's `transform` (`method: "metadata"`, the same as `transform --table --id`) run in-process. Its `Connector.fetch` is replaced: every request goes through snagentic's request scheduler, signed by snagentic, and is checked against a read allow-list. The SDK is given no credential |

## G1: transform through our connector (ADR-0032)

| Test | Result |
|---|---|
| 2 records (S11: a script include, a table with choices) | 1 request, `POST /api/sn_glider/fluent_support/table_relationship_exporter`, 2.7 s |
| The Access Review application, 137 records | 5 requests on the same route (the SDK batches), 9 to 15 s. **No other route was asked for** |
| Fidelity | Built and compared with the mirror as in S16 F1: the same result as the platform-download route. Same known losses; dictionary defaults omitted |
| A record in the mirror that no longer exists (a replaced `sys_ui_list`) | **The whole batch fails** ("Record not found"). `adopt` must check that its records exist first, and report stale mirror copies |

**Allow-list for 4.13.6:** `GET` reads, plus two read-only exports, `POST
/api/sn_glider/fluent_support/table_relationship_exporter` and `POST
/api/sn_glider/metadata/unload/<scope>`.

## Omitted fields

A load that updates an existing record leaves a field the XML doesn't carry untouched. The S11
script include was loaded without its `<description>`, and kept its description. Typed APIs
always write every field they own, so a field removed from source is written empty. Only
`Record()` and dictionary attributes omit fields.

**Consequence for `normalize`:** a field absent from the build is unmanaged, which means no
effect on an update.

## G2: creating a scoped application with no Table API metadata write

1. A `Record({ table: 'sys_app', ... })` in the `global` project was built (`apply_defaults="true"`)
   and loaded into a global update set. This created the application `x_2222332_s17`, recorded as
   "Custom Application".
2. The application was made current, then its update set was created. Push does both today.
3. The application's first script include was loaded into that set. It was recorded, with
   `sys_scope` and `sys_package` set to the new application.

The Table API is still needed for session bookkeeping: update sets, preferences, and moving an
update between sets. It is not used for metadata.

## G3: refresh stability

The 137 Access Review records were transformed a second time into the same project. **No source
file changed.** Only `keys.ts` changed, through `deleted` flags the build toggles on child
records it re-keyed (form elements). In a `configuration` project those flags delete nothing (S16
F3). The ledger and plan must ignore them.

An edit made in the form designer itself was not tested.

## G4: store applications

Not tested. 2.0 refuses to adopt records whose scope is not a custom application on the
instance.

## G5: build time

The Access Review project, 137 records: 3.0 s per build (the `now-sdk` CLI, warm). Plan builds
two ends, so the base build is cached by commit.

## Left on pdi2

- The application `x_2222332_s17` ("S17 created by load") and its script include `S17Util`.
- Global update set `snagentic: S16 F2 [global]`: the `sys_app` update.
- Update sets for `x_2222332_s17`:
  - `snagentic: S17 G2b`, which holds the script include;
  - `snagentic: S17 G2`, empty, created in global.
- The S11 script include was loaded without changes, into `snagentic: live/list-layouts
  [x_2222332_s11]`.
