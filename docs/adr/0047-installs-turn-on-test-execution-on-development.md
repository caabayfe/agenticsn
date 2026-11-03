# 0047. An install turns on ATF test execution on a development instance, in an update set that is never promoted

- Status: Accepted (product owner, 2026-11-03)
- Date: 2026-11-03
- Requirements: G1, G3, ASR-16
- Relates to: 0012 (only development instances are written), 0038 (install by plan, component
  installer), 0046 (number taken on the SDK 4.14 branch)

## Context

Accelerator packs ship ATF tests (the ITSM pack: 128 in its regression suite). The platform runs
none of them until two system properties are on:

- `sn_atf.runner.enabled`: test and suite execution;
- `sn_atf.schedule.enabled`: scheduled suite runs.

They are off on a new personal developer instance. Each install so far needed someone to turn
them on by hand (pdi3, 2026-11-02); the product owner asked for them to be on always
(2026-11-03).

The properties are global records. Changed through the Table API they are captured in the
user's current update set, which during an install can be one of the install's own. Promoted
with the modules, they would turn on test execution in test and production, where ATF changes
records and ServiceNow advises against running it.

## Decision

1. **Every install on a development instance turns on test execution:** after the components
   and before the modules, it sets both properties to `true` where they are not. The plan says
   so. A test or production instance is never written (0012), so it is never turned on there.
2. **The change is recorded apart, and never promoted:** the properties are written in an update
   set of their own, `snagentic: ATF test execution (development only)`, which is set to
   `ignore` once they are written. The user's current application and update set are put back.
3. **Nothing is written when both are on:** the step reads them first.

## Consequences

- An installed pack's tests run on the instance without a manual step.
- An install writes two records it does not list as module changes; the plan and the report
  name them.
- A property a later install finds off again (someone turned it off) is turned on again.

## Alternatives considered

- **Ship the properties in the pack** (foundation): they would travel with its update set to
  test and production, and every pack would restate an out-of-box record.
- **Leave them to the admin:** the gap this ADR closes.
- **Write them in the user's current update set:** the risk of promotion described above.
